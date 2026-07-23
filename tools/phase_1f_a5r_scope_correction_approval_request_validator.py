#!/usr/bin/env python3
"""Validate Phase 1F-A5R scope correction approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a5r/scope-correction-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a5r.scope-correction-approval-request.v1"
EXPECTED_CONTENT_SHA = "17e0419c8707cdecce06243702fa3a83c51714625a71fc6c35ae497f30c31a62"
EXPECTED_A4_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a4/implementation-approval-request.json"
EXPECTED_A4_EVIDENCE_SHA = "31bf23ea7019809bd6cc0db3dc85e01c5ea2e70b62dd6a2cbe1ed50ac9fed7ed"
EXPECTED_A4_CONTENT_SHA = "b812cd16aa2f03a1e7c4e37b06581ec6520b576d979665befb146347020c2425"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A5R_SCOPE_CORRECTION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "a3911bb35d7ebdddb2965f9324a40db19fe87fbe9308250439f2574e673d12ac"
EXPECTED_CONTRACT_CONTENT_SHA = "e9624de2171e8b7c624ac3dd4ec40d46d79d80d81cb21085f35933176ce8cb14"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_VERSIONED_PURE_CONTRACT_IMPLEMENTATION:p1f-20260723-versionedpurecontracta5r:e9624de2171e8b7c624ac3dd4ec40d46d79d80d81cb21085f35933176ce8cb14"
EXPECTED_APPROVAL_SHA = "51ee3b2dee1694ffada7ee9bd20391251f3b73a5fda6d79724b2f16c7bfd9ec4"


class Phase1FA5RValidationError(RuntimeError):
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
        raise Phase1FA5RValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA5RValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA5RValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA5RValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA5RValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA5RValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA5RValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA5RValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A4_EVIDENCE) != EXPECTED_A4_EVIDENCE_SHA:
        raise Phase1FA5RValidationError("SOURCE_A4_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A4_EVIDENCE, "SOURCE_A4_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A4_CONTENT_SHA:
        raise Phase1FA5RValidationError("SOURCE_A4_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA5RValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA5RValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA5RValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA5RValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA5RValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA5RValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA5RValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA5RValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase1FA5RValidationError("APPROVAL_REQUIREMENT_INVALID")

    outcome = content.get("a5_attempt_outcome")
    if not isinstance(outcome, dict):
        raise Phase1FA5RValidationError("A5_ATTEMPT_OUTCOME_INVALID")
    if outcome.get("candidate_committed") is not False or outcome.get("candidate_push_performed") is not False:
        raise Phase1FA5RValidationError("A5_CANDIDATE_NOT_CLOSED")
    if outcome.get("candidate_scope_was_a4_allowlist_only") is not True:
        raise Phase1FA5RValidationError("A5_CANDIDATE_SCOPE_NOT_RECORDED")
    if outcome.get("targeted_candidate_tests_passed") != 17:
        raise Phase1FA5RValidationError("A5_TARGETED_TEST_COUNT_INVALID")
    if outcome.get("full_suite_restored_after_candidate_removal") is not True:
        raise Phase1FA5RValidationError("FULL_SUITE_RESTORATION_NOT_RECORDED")
    if "Phase 1E review validators pin SHA-256 hashes" not in outcome.get("governance_conflict", ""):
        raise Phase1FA5RValidationError("GOVERNANCE_CONFLICT_NOT_RECORDED")

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
            raise Phase1FA5RValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA5RValidationError("APPROVAL_SCOPE_INVALID")
    positive_fields = {
        "implementation_code_allowed",
        "pure_contract_layer_only_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
        "versioned_phase_1f_modules_allowed",
    }
    for field in positive_fields:
        if scope.get(field) is not True:
            raise Phase1FA5RValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in positive_fields and value is not False:
            raise Phase1FA5RValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
        "tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py",
    ]:
        raise Phase1FA5RValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {})
    targeted = tests.get("targeted_approval_request_validator_tests", {})
    full = tests.get("full_tools_unittest_discover", {})
    pre = tests.get("pre_correction_full_tools_unittest_discover_after_candidate_removal", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 6:
        raise Phase1FA5RValidationError("TARGETED_TEST_RESULT_INVALID")
    if pre.get("result") != "PASS" or pre.get("tests") != 775:
        raise Phase1FA5RValidationError("PRE_CORRECTION_FULL_TEST_RESULT_INVALID")
    if full.get("result") != "PASS" or full.get("tests") != 781:
        raise Phase1FA5RValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA5RValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A6_VERSIONED_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL":
        raise Phase1FA5RValidationError("NEXT_GATE_INVALID")

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
    except (Phase1FA5RValidationError, json.JSONDecodeError) as error:
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
