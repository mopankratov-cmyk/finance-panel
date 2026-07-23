#!/usr/bin/env python3
"""Validate Phase 1E-A8 pure contract implementation approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a8/implementation-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1e-a8.implementation-approval-request.v1"
EXPECTED_CONTENT_SHA = "01a743c516d430a81e54d7785e6ca7db986969dd3d8ee0000250bd7e91d4e650"
EXPECTED_A7_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a7/independent-security-review-before-code.json"
EXPECTED_A7_EVIDENCE_SHA = "2646786520c866f32dfb5167164e6fa58731e3ec3747aeac994e6d7cff2bdd94"
EXPECTED_A7_CONTENT_SHA = "bfdcab7a00170ee6b84d88906e1e7257f678dfe821e62aca75ad520f502477c4"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1E_A8_IMPLEMENTATION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "a96ce729f4f1dfa52aecf5422eb112634b788adbaa634763c0d299afdfdf0abe"
EXPECTED_CONTRACT_CONTENT_SHA = "75760670f82163aae3a7dbc9d977865e629cf37b1c3912dc03a053a955738ab5"
EXPECTED_APPROVAL = "APPROVE_PHASE_1E_PURE_CONTRACT_IMPLEMENTATION:p1e-20260722-purecontracta8:75760670f82163aae3a7dbc9d977865e629cf37b1c3912dc03a053a955738ab5"
EXPECTED_APPROVAL_SHA = "34b4ddd0bfbac5ff3c2cb5330cd1d0d20469808808e9d8dc8f91654f6c109c2c"


class Phase1EA8ValidationError(RuntimeError):
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
        raise Phase1EA8ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA8ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA8ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA8ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA8ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA8ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA8ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA8ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A7_EVIDENCE) != EXPECTED_A7_EVIDENCE_SHA:
        raise Phase1EA8ValidationError("SOURCE_A7_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A7_EVIDENCE, "SOURCE_A7_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A7_CONTENT_SHA:
        raise Phase1EA8ValidationError("SOURCE_A7_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1EA8ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1EA8ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA8ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA8ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1EA8ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1EA8ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1EA8ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1EA8ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase1EA8ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in (
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "model_api_calls_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
        "gateway_changes_approved",
        "dependency_changes_approved",
        "credential_migration_approved",
        "oauth_refresh_approved",
        "implementation_performed",
    ):
        if content.get(field) is not False:
            raise Phase1EA8ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1EA8ValidationError("APPROVAL_SCOPE_INVALID")
    for field in ("pure_contract_code_allowed", "allowlisted_tools_files_only", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"):
        if scope.get(field) is not True:
            raise Phase1EA8ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in {"pure_contract_code_allowed", "allowlisted_tools_files_only", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"} and value is not False:
            raise Phase1EA8ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)
    contract_allowlist = contract_content.get("future_code_allowlist")
    if not isinstance(contract_allowlist, list) or not contract_allowlist:
        raise Phase1EA8ValidationError("CONTRACT_ALLOWLIST_INVALID")
    if not all(path.startswith("tools/") for path in contract_allowlist):
        raise Phase1EA8ValidationError("CONTRACT_ALLOWLIST_OUT_OF_SCOPE")
    for path_name in (
        "tools/pankster_runtime_security/credential_broker_contracts.py",
        "tools/pankster_runtime_security/model_broker_contracts.py",
        "tools/pankster_runtime_security/secret_scan.py",
    ):
        if path_name not in contract_allowlist:
            raise Phase1EA8ValidationError("CONTRACT_ALLOWLIST_MISSING", path_name)
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA8ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A9_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL":
        raise Phase1EA8ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "implementation_performed": False,
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
    except (Phase1EA8ValidationError, json.JSONDecodeError) as error:
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
