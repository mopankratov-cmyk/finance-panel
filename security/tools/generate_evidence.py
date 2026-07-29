#!/usr/bin/env python3
"""Generate sanitized Phase 1A evidence artifacts."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import platform
import sys
import tempfile
import unittest
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SECURITY_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = SECURITY_ROOT / "src"
if str(SECURITY_ROOT) not in sys.path:
    sys.path.insert(0, str(SECURITY_ROOT))
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from pankster_security_harness.isolation_probe import IsolationOption, feasibility_decision, inventory
from pankster_security_harness.redaction import assert_no_secret_shape, assert_no_sentinel
from pankster_security_harness.runtime_context import CURRENT_POLICY_VERSION
from pankster_security_harness.test_registry import (
    TEST_ID_REGISTRY,
    baseline_results,
    clear_baseline_results,
    validate_test_id_registry,
)

HARNESS_VERSION = "0.1.0"
SCHEMA_VERSION = "phase1a.evidence.v1"
GENERATION_MANIFEST_SCHEMA_VERSION = "phase1a.evidence.generation.v1"
CURRENT_POINTER_SCHEMA_VERSION = "phase1a.evidence.current.v1"
ISOLATION_PROBE_VERSION = "phase1a.isolation.v1"
EVIDENCE_FILENAMES = (
    "baseline-results.json",
    "safe-prototype-results.json",
    "isolation-inventory.json",
    "test-run-summary.json",
)
GENERATION_MANIFEST_FILENAME = "generation-manifest.json"
CURRENT_POINTER_FILENAME = "current.json"


@dataclass(frozen=True)
class TestObservation:
    test_identity: str
    test_name: str
    status: str
    failure_category: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "test_identity": self.test_identity,
            "test_name": self.test_name,
            "status": self.status,
        }
        if self.failure_category:
            payload["failure_category"] = self.failure_category
        return payload


class SecurityTestResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.observations: dict[str, TestObservation] = {}

    def _test_identity(self, test) -> str:
        explicit = getattr(test, "_pankster_test_identity", None)
        if explicit:
            return explicit
        function = getattr(test, "_testFunc", None)
        if function is not None:
            return f"{function.__module__}.{function.__name__}"
        return test.id()

    def _test_name(self, test) -> str:
        explicit = getattr(test, "_pankster_test_name", None)
        if explicit:
            return explicit
        function = getattr(test, "_testFunc", None)
        if function is not None:
            return function.__name__
        return test.id().split(".")[-1]

    def _record(self, test, status: str, failure_category: str | None = None) -> None:
        identity = self._test_identity(test)
        if identity in self.observations:
            raise AssertionError(f"duplicate test execution identity: {identity}")
        self.observations[identity] = TestObservation(
            test_identity=identity,
            test_name=self._test_name(test),
            status=status,
            failure_category=failure_category,
        )

    def addSuccess(self, test) -> None:
        super().addSuccess(test)
        self._record(test, "PASS")

    def addFailure(self, test, err) -> None:
        super().addFailure(test, err)
        self._record(test, "FAIL", err[0].__name__)

    def addError(self, test, err) -> None:
        super().addError(test, err)
        self._record(test, "ERROR", err[0].__name__)

    def addSkip(self, test, reason) -> None:
        super().addSkip(test, reason)
        self._record(test, "SKIPPED", "skipped")


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pack_id(timestamp: str) -> str:
    safe_timestamp = timestamp.replace("-", "").replace(":", "").replace("T", "t").replace("Z", "z")
    return f"{safe_timestamp}-{uuid.uuid4().hex}"


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discover_suite() -> unittest.TestSuite:
    return unittest.defaultTestLoader.discover(str(SECURITY_ROOT / "tests"), pattern="test_*.py")


def validate_run_accounting(run: dict[str, Any]) -> None:
    summary: dict[str, int] = run["summary"]
    observations: dict[str, TestObservation] = run["observations"]
    tests_run = summary["tests_run"]
    passed = summary["passed"]
    failed = summary["failed"]
    errors = summary["errors"]
    skipped = summary["skipped"]
    if len(observations) != tests_run:
        raise RuntimeError("observation count does not match unittest testsRun")
    if passed + failed + errors + skipped != tests_run:
        raise RuntimeError("test summary accounting invariant failed")
    if not run["successful"]:
        raise RuntimeError("test suite unsuccessful; refusing to generate evidence")
    if failed or errors:
        raise RuntimeError("test suite failed; refusing to generate evidence")


def run_test_suite(suite: unittest.TestSuite | None = None) -> dict[str, Any]:
    previous_baseline_results = baseline_results()
    clear_baseline_results()
    suite = suite or discover_suite()
    stream = io.StringIO()
    runner = unittest.TextTestRunner(stream=stream, verbosity=0, resultclass=SecurityTestResult)
    result: SecurityTestResult = runner.run(suite)
    recorded_baseline_results = baseline_results()
    clear_baseline_results()
    for baseline_result in previous_baseline_results.values():
        from pankster_security_harness.test_registry import record_baseline_result

        record_baseline_result(baseline_result)
    failed = len(result.failures)
    errors = len(result.errors)
    skipped = len(result.skipped)
    summary = {
        "passed": result.testsRun - failed - errors - skipped,
        "failed": failed,
        "errors": errors,
        "skipped": skipped,
        "blocked": 0,
        "tests_run": result.testsRun,
    }
    return {
        "summary": summary,
        "observations": result.observations,
        "successful": result.wasSuccessful(),
        "baseline_records": recorded_baseline_results,
    }


def host_fingerprint() -> dict[str, str]:
    return {
        "system": platform.system(),
        "machine": platform.machine(),
        "probe_version": ISOLATION_PROBE_VERSION,
    }


def _sec_results(observations: dict[str, TestObservation], prefix: str) -> list[dict[str, object]]:
    rows = []
    for test_identity, ids in sorted(TEST_ID_REGISTRY.items()):
        for test_id in ids:
            if not test_id.startswith(prefix):
                continue
            observation = observations.get(test_identity)
            if observation is None:
                raise AssertionError(f"registered test did not execute: {test_identity}")
            row = {
                "test_id": test_id,
                "test_identity": test_identity,
                "test_name": observation.test_name,
                "result": observation.status,
            }
            if observation.failure_category:
                row["failure_category"] = observation.failure_category
            rows.append(row)
    return rows


def _baseline_rows(observations: dict[str, TestObservation], recorded: dict[str, Any]) -> list[dict[str, object]]:
    rows = []
    for test_identity, ids in sorted(TEST_ID_REGISTRY.items()):
        for test_id in ids:
            if not test_id.startswith("SEC-BL-"):
                continue
            observation = observations.get(test_identity)
            if observation is None:
                raise AssertionError(f"registered baseline test did not execute: {test_identity}")
            result = recorded.get(test_id)
            if observation.status == "PASS" and result is None:
                raise AssertionError(f"baseline test did not record BaselineResult: {test_id}")
            payload = result.to_dict()
            payload["test_identity"] = test_identity
            payload["test_name"] = observation.test_name
            payload["execution_result"] = observation.status
            rows.append(payload)
    return rows


def validate_registry_against_observations(observations: dict[str, TestObservation]) -> None:
    validate_test_id_registry(TEST_ID_REGISTRY)
    executed = set(observations)
    missing_tests = sorted(set(TEST_ID_REGISTRY) - executed)
    if missing_tests:
        raise AssertionError(f"registered test did not execute: {missing_tests[0]}")
    unknown_sec_tests = sorted(
        identity
        for identity, observation in observations.items()
        if observation.test_name.startswith("test_sec_") and identity not in TEST_ID_REGISTRY
    )
    if unknown_sec_tests:
        raise AssertionError(f"security test missing registry entry: {unknown_sec_tests[0]}")


def build_evidence(
    *,
    timestamp: str,
    run: dict[str, Any],
    include_host_inventory: bool = True,
    baseline_records: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    validate_run_accounting(run)
    observations: dict[str, TestObservation] = run["observations"]
    summary: dict[str, int] = run["summary"]
    validate_registry_against_observations(observations)

    base = {
        "schema_version": SCHEMA_VERSION,
        "harness_version": HARNESS_VERSION,
        "scope": "synthetic-only",
        "timestamp": timestamp,
    }
    options = inventory()
    decision = feasibility_decision(options)
    safe_results = _sec_results(observations, "SEC-PROT-")
    iso_results = _sec_results(observations, "SEC-ISO-")
    active_baseline_records = baseline_records
    if active_baseline_records is None:
        active_baseline_records = run.get("baseline_records", baseline_results())
    baseline_rows = _baseline_rows(observations, active_baseline_records)
    artifacts = {
        "baseline-results.json": {
            **base,
            "test_ids": [row["test_id"] for row in baseline_rows],
            "results": baseline_rows,
        },
        "safe-prototype-results.json": {
            **base,
            "test_ids": [row["test_id"] for row in safe_results],
            "results": safe_results,
            "policy_version": CURRENT_POLICY_VERSION,
            "env_event_contract": {
                "includes_env_keys": True,
                "includes_value_metadata": True,
                "serializes_environment_values": False,
            },
        },
        "isolation-inventory.json": {
            **base,
            "test_ids": [row["test_id"] for row in iso_results],
            "results": iso_results,
            "production_isolation_gate": decision["production_isolation_gate"],
            "decision": decision,
            "options": [option.to_dict() for option in options],
        },
        "test-run-summary.json": {
            **base,
            "test_ids": ["SEC-BL-001..006", "SEC-PROT-001..052", "SEC-ISO-001..004"],
            "command": "cd security && PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -v",
            "test_results": [
                item.to_dict() for item in sorted(observations.values(), key=lambda item: item.test_identity)
            ],
            **summary,
        },
    }
    if include_host_inventory:
        artifacts["isolation-inventory.json"]["host_fingerprint"] = host_fingerprint()
    validate_evidence(artifacts)
    validate_recorded_host_inventory(artifacts["isolation-inventory.json"])
    return artifacts


def validate_evidence(artifacts: dict[str, dict[str, Any]]) -> None:
    rendered = json.dumps(artifacts, sort_keys=True)
    if "/Users/" in rendered:
        raise AssertionError("real path leaked into evidence")
    if "env_values" in rendered or "redacted_env_values" in rendered:
        raise AssertionError("environment values key leaked into evidence")
    assert_no_sentinel(rendered)
    assert_no_secret_shape(rendered)
    for name, payload in artifacts.items():
        if payload.get("schema_version") != SCHEMA_VERSION:
            raise AssertionError(f"invalid schema_version for {name}")
        if payload.get("harness_version") != HARNESS_VERSION:
            raise AssertionError(f"invalid harness_version for {name}")
        if payload.get("scope") != "synthetic-only":
            raise AssertionError(f"invalid scope for {name}")
        if not payload.get("timestamp"):
            raise AssertionError(f"missing timestamp for {name}")
        if not payload.get("test_ids"):
            raise AssertionError(f"missing test_ids for {name}")


def validate_recorded_host_inventory(payload: dict[str, Any]) -> None:
    rendered = json.dumps(payload, sort_keys=True)
    if "/Users/" in rendered:
        raise AssertionError("real path leaked into host inventory")
    assert_no_sentinel(rendered)
    assert_no_secret_shape(rendered)
    fingerprint = payload.get("host_fingerprint")
    if not isinstance(fingerprint, dict) or set(fingerprint) != {"system", "machine", "probe_version"}:
        raise AssertionError("invalid host fingerprint schema")
    if fingerprint["probe_version"] != ISOLATION_PROBE_VERSION:
        raise AssertionError("invalid isolation probe version")
    raw_options = payload.get("options")
    if not isinstance(raw_options, list) or not raw_options:
        raise AssertionError("missing isolation options")
    options = [IsolationOption(**option) for option in raw_options]
    decision = feasibility_decision(options)
    if payload.get("decision") != decision:
        raise AssertionError("recorded isolation decision does not match recorded options")
    if payload.get("production_isolation_gate") != decision["production_isolation_gate"]:
        raise AssertionError("recorded production gate does not match recorded decision")
    if payload.get("production_isolation_gate") != "BLOCKED_ON_BACKEND_SELECTION":
        raise AssertionError("phase 1A host inventory must remain fail closed")


def generation_manifest(pack_id: str, generation_dir: Path) -> dict[str, Any]:
    files = []
    for name in EVIDENCE_FILENAMES:
        path = generation_dir / name
        files.append(
            {
                "path": name,
                "bytes": path.stat().st_size,
                "sha256": _sha256_path(path),
            }
        )
    return {
        "schema_version": GENERATION_MANIFEST_SCHEMA_VERSION,
        "pack_id": pack_id,
        "files": files,
    }


def validate_generation_dir(generation_dir: Path, *, expected_manifest_sha256: str | None = None) -> dict[str, dict[str, Any]]:
    manifest_path = generation_dir / GENERATION_MANIFEST_FILENAME
    if expected_manifest_sha256 is not None and _sha256_path(manifest_path) != expected_manifest_sha256:
        raise AssertionError("current pointer manifest hash mismatch")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != GENERATION_MANIFEST_SCHEMA_VERSION:
        raise AssertionError("invalid generation manifest schema")
    manifest_files = {item["path"]: item for item in manifest.get("files", [])}
    if set(manifest_files) != set(EVIDENCE_FILENAMES):
        raise AssertionError("generation manifest file set mismatch")
    artifacts = {}
    for name in EVIDENCE_FILENAMES:
        path = generation_dir / name
        expected = manifest_files[name]
        data = path.read_bytes()
        if len(data) != expected["bytes"]:
            raise AssertionError(f"generation byte mismatch: {name}")
        if hashlib.sha256(data).hexdigest() != expected["sha256"]:
            raise AssertionError(f"generation hash mismatch: {name}")
        artifacts[name] = json.loads(data)
    validate_evidence(artifacts)
    validate_recorded_host_inventory(artifacts["isolation-inventory.json"])
    return artifacts


def write_evidence(
    artifacts: dict[str, dict[str, Any]],
    evidence_dir: Path,
    *,
    pack_id: str | None = None,
    fail_at: str | None = None,
) -> str:
    validate_evidence(artifacts)
    validate_recorded_host_inventory(artifacts["isolation-inventory.json"])
    evidence_dir.mkdir(parents=True, exist_ok=True)
    generations_dir = evidence_dir / "generations"
    generations_dir.mkdir(parents=True, exist_ok=True)
    pack_id = pack_id or _pack_id(artifacts["test-run-summary.json"]["timestamp"])
    generation_dir = generations_dir / pack_id
    if generation_dir.exists():
        raise FileExistsError(f"generation already exists: {pack_id}")
    with tempfile.TemporaryDirectory(prefix=f".{pack_id}.", dir=generations_dir) as temp_root:
        temp_dir = Path(temp_root)
        for name, payload in artifacts.items():
            (temp_dir / name).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        staged = {name: json.loads((temp_dir / name).read_text(encoding="utf-8")) for name in EVIDENCE_FILENAMES}
        validate_evidence(staged)
        manifest = generation_manifest(pack_id, temp_dir)
        (temp_dir / GENERATION_MANIFEST_FILENAME).write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        validate_generation_dir(temp_dir)
        if fail_at == "before_generation_rename":
            raise RuntimeError("injected failure before generation rename")
        os.replace(temp_dir, generation_dir)
    if fail_at == "after_generation_creation":
        raise RuntimeError("injected failure after generation creation")
    manifest_sha = _sha256_path(generation_dir / GENERATION_MANIFEST_FILENAME)
    pointer = {
        "schema_version": CURRENT_POINTER_SCHEMA_VERSION,
        "pack_id": pack_id,
        "generation_manifest_sha256": manifest_sha,
    }
    current_tmp = evidence_dir / f".current.{pack_id}.tmp"
    current_tmp.write_text(json.dumps(pointer, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if fail_at == "during_pointer_creation":
        raise RuntimeError("injected failure during pointer creation")
    os.replace(current_tmp, evidence_dir / CURRENT_POINTER_FILENAME)
    for legacy_name in EVIDENCE_FILENAMES:
        legacy_path = evidence_dir / legacy_name
        if legacy_path.exists():
            legacy_path.unlink()
    return pack_id


def load_current_pointer(evidence_dir: Path) -> dict[str, str]:
    pointer = json.loads((evidence_dir / CURRENT_POINTER_FILENAME).read_text(encoding="utf-8"))
    if pointer.get("schema_version") != CURRENT_POINTER_SCHEMA_VERSION:
        raise AssertionError("invalid current pointer schema")
    if not pointer.get("pack_id") or not pointer.get("generation_manifest_sha256"):
        raise AssertionError("invalid current pointer")
    assert_no_sentinel(pointer)
    assert_no_secret_shape(pointer)
    return pointer


def load_existing(evidence_dir: Path) -> dict[str, dict[str, Any]]:
    pointer = load_current_pointer(evidence_dir)
    generation_dir = evidence_dir / "generations" / pointer["pack_id"]
    return validate_generation_dir(generation_dir, expected_manifest_sha256=pointer["generation_manifest_sha256"])


def _portable_artifacts(artifacts: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        name: artifacts[name]
        for name in (
            "baseline-results.json",
            "safe-prototype-results.json",
            "test-run-summary.json",
        )
    }


def check_evidence(
    expected: dict[str, dict[str, Any]],
    evidence_dir: Path,
    *,
    refresh_host_inventory: bool,
    require_same_host: bool = False,
) -> None:
    existing = load_existing(evidence_dir)
    validate_evidence(existing)
    validate_recorded_host_inventory(existing["isolation-inventory.json"])
    normalized_expected = json.loads(json.dumps(expected, sort_keys=True))
    if _portable_artifacts(existing) != _portable_artifacts(normalized_expected):
        raise SystemExit("portable evidence is stale")
    existing_fingerprint = existing["isolation-inventory.json"].get("host_fingerprint")
    expected_fingerprint = normalized_expected["isolation-inventory.json"].get("host_fingerprint")
    print("PORTABLE_EVIDENCE_OK")
    if existing_fingerprint != expected_fingerprint:
        print("HOST_FINGERPRINT_MISMATCH")
        print("HOST_INVENTORY_SCHEMA_OK")
        print("HOST_INVENTORY_NOT_REPROBED")
        if require_same_host:
            raise SystemExit("HOST_FINGERPRINT_MISMATCH")
        return
    if existing["isolation-inventory.json"] != normalized_expected["isolation-inventory.json"]:
        raise SystemExit("host inventory is stale")
    print("HOST_INVENTORY_OK")


def generate(
    *,
    check: bool,
    refresh_host_inventory: bool,
    require_same_host: bool,
    evidence_dir: Path,
) -> dict[str, dict[str, Any]]:
    run = run_test_suite()
    try:
        validate_run_accounting(run)
    except RuntimeError as error:
        raise SystemExit(f"{error}; evidence not written") from error
    timestamp = _utc_timestamp()
    if check or refresh_host_inventory:
        existing = load_existing(evidence_dir)
        timestamp = existing["test-run-summary.json"]["timestamp"]
    artifacts = build_evidence(timestamp=timestamp, run=run)
    if check:
        check_evidence(
            artifacts,
            evidence_dir,
            refresh_host_inventory=refresh_host_inventory,
            require_same_host=require_same_host,
        )
    else:
        write_evidence(artifacts, evidence_dir)
    return artifacts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="compare generated evidence with committed files")
    parser.add_argument("--refresh-host-inventory", action="store_true", help="refresh host-bound inventory evidence")
    parser.add_argument("--require-same-host", action="store_true", help="fail --check when host fingerprint differs")
    parser.add_argument("--evidence-dir", default=str(SECURITY_ROOT / "evidence"))
    args = parser.parse_args(argv)

    generate(
        check=args.check,
        refresh_host_inventory=args.refresh_host_inventory,
        require_same_host=args.require_same_host,
        evidence_dir=Path(args.evidence_dir),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
