#!/usr/bin/env python3
"""Validate Phase 1F-A1 runtime integration owner approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a1/runtime-integration-owner-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a1.runtime-integration-owner-approval-request.v1"
EXPECTED_CONTENT_SHA = "555723638ab7600a4b42001c0009c5154c0312c66d56891187449ef0d0a58f93"
EXPECTED_A0_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a0/runtime-integration-planning.json"
EXPECTED_A0_EVIDENCE_SHA = "72449b19d3a764449f8e97412ef9deb9589c4ac3639532431eaea64539b6d5bd"
EXPECTED_A0_CONTENT_SHA = "7d6a0ce18b9c20055fd5372e7f27a1977743cd191a28488187ce49713bc102b4"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "5d17961e68f4b63f444d2b44f338a92149c429a5ca1e5241b42d6bdcd5424783"
EXPECTED_CONTRACT_CONTENT_SHA = "082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_RUNTIME_IMPLEMENTATION_SCOPE_LOCK:p1f-20260723-scopea1:082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304"
EXPECTED_APPROVAL_SHA = "cbf30907ee949ca05f46b54b99e4f8dc827d1c60ee8c5a4e5a5900f23f116e6f"


class Phase1FA1ValidationError(RuntimeError):
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
        raise Phase1FA1ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA1ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA1ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA1ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA1ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA1ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA1ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA1ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A0_EVIDENCE) != EXPECTED_A0_EVIDENCE_SHA:
        raise Phase1FA1ValidationError("SOURCE_A0_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A0_EVIDENCE, "SOURCE_A0_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A0_CONTENT_SHA:
        raise Phase1FA1ValidationError("SOURCE_A0_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA1ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA1ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA1ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA1ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA1ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA1ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA1ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA1ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_scope_lock") is not True:
        raise Phase1FA1ValidationError("APPROVAL_REQUIREMENT_INVALID")

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
            raise Phase1FA1ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA1ValidationError("APPROVAL_SCOPE_INVALID")
    positive_fields = {
        "phase_1f_a2_scope_lock_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
    }
    for field in positive_fields:
        if scope.get(field) is not True:
            raise Phase1FA1ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in positive_fields and value is not False:
            raise Phase1FA1ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "docs/program/PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK.md",
        "security/evidence/phase-1f-a2/runtime-implementation-scope-lock.json",
        "tools/phase_1f_a2_runtime_implementation_scope_lock_validator.py",
        "tools/tests/test_phase_1f_a2_runtime_implementation_scope_lock_validator.py",
    ]:
        raise Phase1FA1ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1FA1ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK_AFTER_OWNER_APPROVAL":
        raise Phase1FA1ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1FA1ValidationError, json.JSONDecodeError) as error:
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
