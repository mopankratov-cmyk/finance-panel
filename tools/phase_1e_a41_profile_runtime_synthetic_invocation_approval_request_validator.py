#!/usr/bin/env python3
"""Validate Phase 1E-A41 profile runtime synthetic invocation approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a41/profile-runtime-synthetic-invocation-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1e-a41.profile-runtime-synthetic-invocation-approval-request.v1"
EXPECTED_CONTENT_SHA = "ccb5f918a3888cd18c6c0e1df2cb8c577f1b5532628595e6f8f2c2de2d8d6194"
EXPECTED_A40_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a40/profile-runtime-invocation-contract-review.json"
EXPECTED_A40_EVIDENCE_SHA = "f0564dba07f353e1b5f6b099a1e536688a9fe509650f34ad94557e76d4032656"
EXPECTED_A40_CONTENT_SHA = "8fe62ed2751b27731fa0a75da4b1aee8783df46823e197061e3c03225635c266"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1E_A41_PROFILE_RUNTIME_SYNTHETIC_INVOCATION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "21b687883646c74d8eac5e798f2a3df3018c9882e43d973b6876fc58d25bf22f"
EXPECTED_CONTRACT_CONTENT_SHA = "fca909c6d3456689945feaa741b5ea9fb3bb40ec4b9f0449d2b55ec50e6bfc78"
EXPECTED_APPROVAL = "APPROVE_PHASE_1E_PROFILE_RUNTIME_SYNTHETIC_INVOCATION_CONTRACT:p1e-20260723-syntheticinvocationa41:fca909c6d3456689945feaa741b5ea9fb3bb40ec4b9f0449d2b55ec50e6bfc78"
EXPECTED_APPROVAL_SHA = "b39daa7c8561f11329db85d3e263a56ccc8549d5604db3a11dda8a530dc8a54e"


class Phase1EA41ValidationError(RuntimeError):
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
        raise Phase1EA41ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA41ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA41ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA41ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA41ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA41ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA41ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA41ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A40_EVIDENCE) != EXPECTED_A40_EVIDENCE_SHA:
        raise Phase1EA41ValidationError("SOURCE_A40_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A40_EVIDENCE, "SOURCE_A40_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A40_CONTENT_SHA:
        raise Phase1EA41ValidationError("SOURCE_A40_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1EA41ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1EA41ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA41ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA41ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1EA41ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1EA41ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1EA41ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1EA41ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_integration") is not True:
        raise Phase1EA41ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in (
        "runtime_execution_approved",
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "model_api_calls_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "dependency_changes_approved",
        "credential_migration_approved",
        "oauth_refresh_approved",
        "integration_performed",
    ):
        if content.get(field) is not False:
            raise Phase1EA41ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1EA41ValidationError("APPROVAL_SCOPE_INVALID")
    positive_fields = {
        "disabled_by_default_profile_runtime_synthetic_invocation_contract_allowed",
        "tools_runtime_security_files_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
    }
    for field in positive_fields:
        if scope.get(field) is not True:
            raise Phase1EA41ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in positive_fields and value is not False:
            raise Phase1EA41ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)
    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "tools/pankster_runtime_security/profile_runtime_synthetic_invocation_contracts.py",
        "tools/tests/test_pankster_runtime_security_profile_runtime_synthetic_invocation_contracts.py",
    ]:
        raise Phase1EA41ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA41ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A42_PROFILE_RUNTIME_SYNTHETIC_INVOCATION_CONTRACT_AFTER_OWNER_APPROVAL":
        raise Phase1EA41ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "integration_performed": False,
        "runtime_execution_approved": False,
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
    except (Phase1EA41ValidationError, json.JSONDecodeError) as error:
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
