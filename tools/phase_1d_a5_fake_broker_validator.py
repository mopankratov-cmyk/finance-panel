#!/usr/bin/env python3
"""Validate the Phase 1D-A5 fake grant registry and broker evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a5/fake-grant-registry-and-broker-implementation.json"
EXPECTED_SCHEMA = "pankster.phase1d-a5.fake-grant-registry-and-broker-implementation.v1"
EXPECTED_CONTENT_SHA = "ea1bfa81ea2dedfcd2db87c3ac754db1dae5723239a90481cb5e85a1f75d2bd9"
EXPECTED_A4_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a4/environment-sanitizer-implementation.json"
EXPECTED_A4_EVIDENCE_SHA = "780f139e4ba2e7ca0ac22cfa152944c2317e4128c9bd21e32ad0c9258ff049e9"
EXPECTED_A4_CONTENT_SHA = "134354cebf43a950887d039b3bd11d244ef8eef28d19ae4370c161d32e37ed3a"
EXPECTED_FILE_HASHES = {
    "tools/pankster_runtime_security/fake_grants.py": "253dd3fbb5d630cc4c68e93d999d6ea68fcdddb4e6c778df0056194098dc5d78",
    "tools/pankster_runtime_security/fake_model_broker.py": "f7ec0808d992fbec3e22bb81affec23e59d1e22dc31be7763f5c4fd6454a73f4",
    "tools/tests/test_pankster_runtime_security_fake_grants.py": "bcde3d673600eda2ae7f2d7c781d185956c96741a4df1a6edcded11f486bd4cf",
    "tools/tests/test_pankster_runtime_security_fake_model_broker.py": "9a07e206c5b872293c31ac5007436cae6986d95cd9065404e3c98d0ce308c5c1",
}


class Phase1DA5ValidationError(RuntimeError):
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
        raise Phase1DA5ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA5ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA5ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA5ValidationError("FILE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1DA5ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1DA5ValidationError(reason, ",".join(missing))


def _expect_all_bool(contract: object, expected_value: bool, reason: str) -> None:
    if not isinstance(contract, dict):
        raise Phase1DA5ValidationError(reason, "not an object")
    for field, value in contract.items():
        if value is not expected_value:
            raise Phase1DA5ValidationError(reason, field)


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA5ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA5ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA5ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA5ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A4_EVIDENCE) != EXPECTED_A4_EVIDENCE_SHA:
        raise Phase1DA5ValidationError("SOURCE_A4_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A4_EVIDENCE, "SOURCE_A4_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A4_CONTENT_SHA:
        raise Phase1DA5ValidationError("SOURCE_A4_CONTENT_SHA_UNEXPECTED")

    if content.get("implemented_files") != EXPECTED_FILE_HASHES:
        raise Phase1DA5ValidationError("IMPLEMENTED_FILE_HASHES_UNEXPECTED")
    for relative_path, expected_hash in EXPECTED_FILE_HASHES.items():
        if _sha256_file(PROJECT_ROOT / relative_path) != expected_hash:
            raise Phase1DA5ValidationError("IMPLEMENTED_FILE_HASH_MISMATCH", relative_path)
    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA5ValidationError(f"{field.upper()}_NOT_FALSE")

    grant_contract = content.get("fake_grant_contract")
    if not isinstance(grant_contract, dict):
        raise Phase1DA5ValidationError("FAKE_GRANT_CONTRACT_INVALID")
    expected_grant_flags = (
        "grant_id_deterministic_within_registry",
        "attempt_binding_required",
        "runtime_identity_binding_required",
        "model_allowlist_enforced",
        "operation_allowlist_enforced",
        "budget_enforced_before_response",
        "replay_detection",
        "expiry_supported",
    )
    for field in expected_grant_flags:
        if grant_contract.get(field) is not True:
            raise Phase1DA5ValidationError("FAKE_GRANT_CONTRACT_SCOPE_INVALID", field)
    if grant_contract.get("grant_reference_secret") is not False:
        raise Phase1DA5ValidationError("GRANT_REFERENCE_SECRET_NOT_FALSE")
    if grant_contract.get("grant_id_prefix") != "grant_opaque_" or grant_contract.get("grant_id_hex_length") != 32:
        raise Phase1DA5ValidationError("GRANT_ID_SHAPE_INVALID")

    broker_contract = content.get("fake_broker_contract")
    if not isinstance(broker_contract, dict):
        raise Phase1DA5ValidationError("FAKE_BROKER_CONTRACT_INVALID")
    for field in ("provider_network_calls", "provider_sdks_used", "real_credentials_used"):
        if broker_contract.get(field) is not False:
            raise Phase1DA5ValidationError("FAKE_BROKER_SIDE_EFFECT_SCOPE_INVALID", field)
    for field in ("returns_synthetic_payload_only", "denial_response_has_no_payload", "audit_event_id_secret_free", "usage_hash_secret_free"):
        if broker_contract.get(field) is not True:
            raise Phase1DA5ValidationError("FAKE_BROKER_CONTRACT_SCOPE_INVALID", field)

    _expect_all_bool(content.get("purity_contract"), False, "PURITY_CONTRACT_VIOLATION")
    tests = content.get("test_results", {}).get("targeted_fake_grant_and_broker_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 10:
        raise Phase1DA5ValidationError("TARGETED_TEST_RESULT_INVALID")
    _expect_subset(
        content.get("fail_closed_cases"),
        {
            "missing_grant",
            "expired_grant",
            "profile_mismatch",
            "task_mismatch",
            "attempt_mismatch",
            "runtime_identity_mismatch",
            "provider_family_not_allowlisted",
            "model_not_allowlisted",
            "operation_not_allowlisted",
            "grant_replay_detected",
            "budget_exceeded",
        },
        "FAIL_CLOSED_CASES_INCOMPLETE",
    )
    if content.get("next_gate") != "1D-A6_RUNTIME_ADAPTER_INTERFACE_STUBS":
        raise Phase1DA5ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1DA5ValidationError, json.JSONDecodeError) as error:
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
