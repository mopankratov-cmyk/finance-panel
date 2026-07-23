#!/usr/bin/env python3
"""Validate Phase 1F-A4 implementation approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a4/implementation-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a4.implementation-approval-request.v1"
EXPECTED_CONTENT_SHA = "b812cd16aa2f03a1e7c4e37b06581ec6520b576d979665befb146347020c2425"
EXPECTED_A3_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a3/independent-security-review-before-code.json"
EXPECTED_A3_EVIDENCE_SHA = "0036515b606704da9a3cca43e0e5fdac384e1d059d493481ea2512d59389ecb2"
EXPECTED_A3_CONTENT_SHA = "2b2f87a7b14714f7ecee3c200067100ed01871a810c60671b340536c18ea0b28"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "3aa1c2338a5bbb0370dc8d750ed267bcd7f9016b0a91566fbf6bc402a103d3a3"
EXPECTED_CONTRACT_CONTENT_SHA = "9bb313bcd45c127d9ab46dbfadb6b5e6bfdb697578f6006cab99ce5b0813a491"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_PURE_CONTRACT_IMPLEMENTATION:p1f-20260723-purecontracta4:9bb313bcd45c127d9ab46dbfadb6b5e6bfdb697578f6006cab99ce5b0813a491"
EXPECTED_APPROVAL_SHA = "33ba3199cb30290d25ec3ae66e186c290e729c3251136ea9b2f3feda9020c5b1"


class Phase1FA4ValidationError(RuntimeError):
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
        raise Phase1FA4ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA4ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA4ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA4ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA4ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA4ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA4ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA4ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A3_EVIDENCE) != EXPECTED_A3_EVIDENCE_SHA:
        raise Phase1FA4ValidationError("SOURCE_A3_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A3_EVIDENCE, "SOURCE_A3_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A3_CONTENT_SHA:
        raise Phase1FA4ValidationError("SOURCE_A3_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA4ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA4ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA4ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA4ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA4ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA4ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA4ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA4ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase1FA4ValidationError("APPROVAL_REQUIREMENT_INVALID")

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
        "implementation_performed",
    ):
        if content.get(field) is not False:
            raise Phase1FA4ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA4ValidationError("APPROVAL_SCOPE_INVALID")
    positive_fields = {
        "implementation_code_allowed",
        "pure_contract_layer_only_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
    }
    for field in positive_fields:
        if scope.get(field) is not True:
            raise Phase1FA4ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in positive_fields and value is not False:
            raise Phase1FA4ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "tools/pankster_runtime_security/runtime_integration_contracts.py",
        "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
    ]:
        raise Phase1FA4ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {})
    targeted = tests.get("targeted_approval_request_validator_tests", {})
    full = tests.get("full_tools_unittest_discover", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase1FA4ValidationError("TARGETED_TEST_RESULT_INVALID")
    if full.get("result") != "PASS" or full.get("tests") != 775:
        raise Phase1FA4ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA4ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A5_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL":
        raise Phase1FA4ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "implementation_performed": False,
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
    except (Phase1FA4ValidationError, json.JSONDecodeError) as error:
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
