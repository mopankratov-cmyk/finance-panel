#!/usr/bin/env python3
"""Validate the Phase 1D-A6 runtime adapter interface stub evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a6/runtime-adapter-interface-stubs.json"
EXPECTED_SCHEMA = "pankster.phase1d-a6.runtime-adapter-interface-stubs.v1"
EXPECTED_CONTENT_SHA = "c4a6e7ed09e7964bac9c057a86dc0a2d6a413ff971deeab3609bf905edcda1c0"
EXPECTED_A5_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a5/fake-grant-registry-and-broker-implementation.json"
EXPECTED_A5_EVIDENCE_SHA = "8d0f303ea62261dacc31e1560af4098dc3bfb0e1db0317212537614b0c443643"
EXPECTED_A5_CONTENT_SHA = "ea1bfa81ea2dedfcd2db87c3ac754db1dae5723239a90481cb5e85a1f75d2bd9"
EXPECTED_FILE_HASHES = {
    "tools/pankster_runtime_security/runtime_adapter_contracts.py": "49f51b5c5dad11655bba9629983ee1213b11babf3321015c5df643212a218c25",
    "tools/tests/test_pankster_runtime_security_runtime_adapter_contracts.py": "f55fdc33bae1ee9d09e9e65e9e618dc0aefde497ab599a28bdb5573ed50a83bb",
}


class Phase1DA6ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_json(path: Path, missing_reason: str) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1DA6ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA6ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA6ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA6ValidationError("FILE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA6ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA6ValidationError(reason, ",".join(missing))


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA6ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA6ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA6ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA6ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A5_EVIDENCE) != EXPECTED_A5_EVIDENCE_SHA:
        raise Phase1DA6ValidationError("SOURCE_A5_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A5_EVIDENCE, "SOURCE_A5_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A5_CONTENT_SHA:
        raise Phase1DA6ValidationError("SOURCE_A5_CONTENT_SHA_UNEXPECTED")

    if content.get("implemented_files") != EXPECTED_FILE_HASHES:
        raise Phase1DA6ValidationError("IMPLEMENTED_FILE_HASHES_UNEXPECTED")
    for relative_path, expected_hash in EXPECTED_FILE_HASHES.items():
        if _sha256_file(PROJECT_ROOT / relative_path) != expected_hash:
            raise Phase1DA6ValidationError("IMPLEMENTED_FILE_HASH_MISMATCH", relative_path)
    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA6ValidationError(f"{field.upper()}_NOT_FALSE")

    contract = content.get("runtime_adapter_contract")
    if not isinstance(contract, dict):
        raise Phase1DA6ValidationError("RUNTIME_ADAPTER_CONTRACT_INVALID")
    for field in ("default_adapter_enabled", "default_broker_channel_enabled", "default_sandbox_launch_enabled", "sandbox_launch_implemented", "broker_channel_implemented", "subprocess_execution", "provider_network_calls", "real_credentials_used"):
        if contract.get(field) is not False:
            raise Phase1DA6ValidationError("RUNTIME_ADAPTER_DISABLED_SCOPE_INVALID", field)
    for field in ("explicit_environment_input_only", "sanitizer_applied_before_launch_denial_when_enabled", "denies_before_environment_materialization_on_invalid_context", "grant_binding_required_for_broker_forward"):
        if contract.get(field) is not True:
            raise Phase1DA6ValidationError("RUNTIME_ADAPTER_CONTRACT_SCOPE_INVALID", field)

    purity = content.get("purity_contract")
    if not isinstance(purity, dict):
        raise Phase1DA6ValidationError("PURITY_CONTRACT_INVALID")
    for field, value in purity.items():
        if value is not False:
            raise Phase1DA6ValidationError("PURITY_CONTRACT_VIOLATION", field)
    tests = content.get("test_results", {}).get("targeted_runtime_adapter_contract_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 6:
        raise Phase1DA6ValidationError("TARGETED_TEST_RESULT_INVALID")
    _expect_subset(
        content.get("fail_closed_reasons"),
        {
            "RUNTIME_ADAPTER_DISABLED",
            "RUNTIME_CONTEXT_FIELD_MISSING:<field>",
            "RUNTIME_GRANT_MISSING",
            "RUNTIME_GRANT_INVALID",
            "RUNTIME_COMMAND_MISSING",
            "SANDBOX_LAUNCH_NOT_IMPLEMENTED",
            "BROKER_CHANNEL_DISABLED",
            "GRANT_NOT_BOUND_TO_CONTEXT",
            "BROKER_OPERATION_MISSING",
            "BROKER_SEQUENCE_MISSING",
            "BROKER_PAYLOAD_HASH_MISSING",
            "BROKER_CHANNEL_NOT_IMPLEMENTED",
        },
        "FAIL_CLOSED_REASONS_INCOMPLETE",
    )
    if content.get("next_gate") != "1D-A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT":
        raise Phase1DA6ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implemented_files": sorted(EXPECTED_FILE_HASHES),
        "deployment_approved": False,
        "production_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-evidence"])
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-evidence":
            _json_print(validate_evidence(args.evidence))
            return 0
    except (Phase1DA6ValidationError, json.JSONDecodeError) as error:
        reason = getattr(error, "reason", error.__class__.__name__)
        detail = getattr(error, "detail", str(error))
        payload = {"result": "DENIED", "mode": args.mode, "reason": reason}
        if detail and detail != reason:
            payload["detail"] = detail
        _json_print(payload)
        return 1
    raise AssertionError(f"unhandled mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
