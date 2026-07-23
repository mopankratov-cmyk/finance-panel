#!/usr/bin/env python3
"""Validate Phase 1F-A2 runtime implementation scope lock evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a2/runtime-implementation-scope-lock.json"
EXPECTED_SCHEMA = "pankster.phase1f-a2.runtime-implementation-scope-lock.v1"
EXPECTED_CONTENT_SHA = "7514aa9559a12d89793b9037922281e61d5233b88f94fd6d8b8852ac64ac485f"
EXPECTED_A1_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a1/runtime-integration-owner-approval-request.json"
EXPECTED_A1_EVIDENCE_SHA = "b0b4769653371a239d678c8bb879a13281ab10484e87628697b56c19d93752cc"
EXPECTED_A1_CONTENT_SHA = "555723638ab7600a4b42001c0009c5154c0312c66d56891187449ef0d0a58f93"
EXPECTED_A1_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST.ready.json"
EXPECTED_A1_CONTRACT_FILE_SHA = "5d17961e68f4b63f444d2b44f338a92149c429a5ca1e5241b42d6bdcd5424783"
EXPECTED_A1_CONTRACT_CONTENT_SHA = "082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_RUNTIME_IMPLEMENTATION_SCOPE_LOCK:p1f-20260723-scopea1:082bc5f87eba718898e979b3e3b031f6792b248b321891d74a27c908b712a304"
EXPECTED_APPROVAL_SHA = "cbf30907ee949ca05f46b54b99e4f8dc827d1c60ee8c5a4e5a5900f23f116e6f"


class Phase1FA2ValidationError(RuntimeError):
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
        raise Phase1FA2ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA2ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA2ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA2ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA2ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA2ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA2ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA2ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A1_EVIDENCE) != EXPECTED_A1_EVIDENCE_SHA:
        raise Phase1FA2ValidationError("SOURCE_A1_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A1_EVIDENCE, "SOURCE_A1_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A1_CONTENT_SHA:
        raise Phase1FA2ValidationError("SOURCE_A1_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_A1_CONTRACT) != EXPECTED_A1_CONTRACT_FILE_SHA:
        raise Phase1FA2ValidationError("SOURCE_A1_CONTRACT_SHA_MISMATCH")
    contract = _load_json(EXPECTED_A1_CONTRACT, "SOURCE_A1_CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA2ValidationError("SOURCE_A1_CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_A1_CONTRACT_CONTENT_SHA:
        raise Phase1FA2ValidationError("SOURCE_A1_CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_A1_CONTRACT_CONTENT_SHA:
        raise Phase1FA2ValidationError("SOURCE_A1_CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("approval_consumed")
    if not isinstance(approval, dict):
        raise Phase1FA2ValidationError("APPROVAL_CONSUMED_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA2ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA2ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA2ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_scope_respected") is not True:
        raise Phase1FA2ValidationError("APPROVAL_SCOPE_NOT_RESPECTED")

    for field in (
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
        "implementation_code_approved",
        "integration_performed",
        "runtime_execution_approved",
    ):
        if content.get(field) is not False:
            raise Phase1FA2ValidationError(f"{field.upper()}_NOT_FALSE")

    allowlist = content.get("future_code_allowlist_after_separate_a4_owner_approval")
    expected_allowlist = [
        "tools/pankster_runtime_security/runtime_integration_contracts.py",
        "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
    ]
    if allowlist != expected_allowlist:
        raise Phase1FA2ValidationError("FUTURE_CODE_ALLOWLIST_INVALID")
    forbidden = set(content.get("forbidden_file_scope", []))
    for item in ("app/", "lib/", "package.json", ".env*", "gateway.py", "web_server.py", "agent/conversation_loop.py"):
        if item not in forbidden:
            raise Phase1FA2ValidationError("FORBIDDEN_SCOPE_MISSING", item)
    constraints = content.get("future_code_constraints")
    if not isinstance(constraints, dict) or not constraints:
        raise Phase1FA2ValidationError("FUTURE_CODE_CONSTRAINTS_INVALID")
    for field, value in constraints.items():
        if value is not True:
            raise Phase1FA2ValidationError("FUTURE_CODE_CONSTRAINT_NOT_TRUE", field)
    approvals = set(content.get("separate_approval_required_for", []))
    for item in (
        "any implementation code after A3 independent security review",
        "any provider SDK use",
        "any sandbox or subprocess launch",
        "any real credential read or OAuth refresh",
        "any gateway/web_server/profile/canary change",
        "any production deployment",
    ):
        if item not in approvals:
            raise Phase1FA2ValidationError("SEPARATE_APPROVAL_MISSING", item)
    tests = content.get("test_results", {})
    targeted = tests.get("targeted_1f_a2_validator_tests", {})
    full = tests.get("full_tools_unittest_discover", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase1FA2ValidationError("TARGETED_TEST_RESULT_INVALID")
    if full.get("result") != "PASS" or full.get("tests") != 765:
        raise Phase1FA2ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE":
        raise Phase1FA2ValidationError("NEXT_GATE_INVALID")
    if content.get("verdict") != "READY_FOR_PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE_NOT_IMPLEMENTATION":
        raise Phase1FA2ValidationError("VERDICT_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "implementation_approved": False,
        "production_approved": False,
        "runtime_execution_approved": False,
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
    except (Phase1FA2ValidationError, json.JSONDecodeError) as error:
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
