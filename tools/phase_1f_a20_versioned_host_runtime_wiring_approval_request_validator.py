#!/usr/bin/env python3
"""Validate Phase 1F-A20 versioned host runtime wiring approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a20/versioned-host-runtime-wiring-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a20.versioned-host-runtime-wiring-approval-request.v1"
EXPECTED_CONTENT_SHA = "d8749e4d31c3ccf7c1d4f3f128878d9a5e011d62736ec15fa60d9256208fda43"
EXPECTED_A19_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a19/versioned-host-runtime-execution-contract-review.json"
EXPECTED_A19_EVIDENCE_SHA = "4481362d362fbf1c2c5f2ef0ab7f37fc7fb7e42bed9e8935f8c61ebea5b6f362"
EXPECTED_A19_CONTENT_SHA = "41a2792e649683d4aae3b17e622c40a9a5253fd1fd504f7bafb55a2e15fcafb0"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "f4d30d7b4ba5de08a8b6b4778728bfa50a06c3e8f04b8e4e748d8b1ea9cc3fa0"
EXPECTED_CONTRACT_CONTENT_SHA = "03cea91919933aab63d54d5bcfdb0368489d149373bf281c0d88a6275bb19543"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT:p1f-20260723-versionedhostwiringa20:03cea91919933aab63d54d5bcfdb0368489d149373bf281c0d88a6275bb19543"
EXPECTED_APPROVAL_SHA = "1e32bf6bb16ca879f212bb79b9a44bdf960f7504fd6e997005311686444fa692"
EXPECTED_FUTURE_FILE_SCOPE = [
    "tools/pankster_runtime_security/host_runtime_wiring_phase1f_contracts.py",
    "tools/tests/test_pankster_runtime_security_host_runtime_wiring_phase1f_contracts.py",
]


class Phase1FA20ValidationError(RuntimeError):
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
        raise Phase1FA20ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA20ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA20ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA20ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA20ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA20ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA20ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA20ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A19_EVIDENCE) != EXPECTED_A19_EVIDENCE_SHA:
        raise Phase1FA20ValidationError("SOURCE_A19_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A19_EVIDENCE, "SOURCE_A19_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A19_CONTENT_SHA:
        raise Phase1FA20ValidationError("SOURCE_A19_CONTENT_SHA_UNEXPECTED")

    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA20ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA20ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA20ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA20ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA20ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA20ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA20ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA20ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA20ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase1FA20ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in (
        "credential_migration_approved",
        "dependency_changes_approved",
        "deployment_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "implementation_performed",
        "model_api_calls_approved",
        "oauth_refresh_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "runtime_execution_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
    ):
        if content.get(field) is not False:
            raise Phase1FA20ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA20ValidationError("APPROVAL_SCOPE_INVALID")
    allowed_true = {
        "disabled_by_default_versioned_host_runtime_wiring_contract_allowed",
        "implementation_code_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
        "pure_contract_layer_only_allowed",
        "unit_tests_allowed",
        "versioned_host_runtime_wiring_module_allowed",
    }
    for field in allowed_true:
        if scope.get(field) is not True:
            raise Phase1FA20ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in allowed_true and value is not False:
            raise Phase1FA20ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    if content.get("future_file_scope_allowlist") != EXPECTED_FUTURE_FILE_SCOPE:
        raise Phase1FA20ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    future_evidence = content.get("required_future_integration_evidence", {})
    for field, value in future_evidence.items():
        if value is not True:
            raise Phase1FA20ValidationError("REQUIRED_FUTURE_EVIDENCE_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("phase_1f_a19_validator", {}).get("result") != "PASS":
        raise Phase1FA20ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    targeted = tests.get("targeted_approval_request_validator_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase1FA20ValidationError("TARGETED_TEST_RESULT_INVALID")
    full = tests.get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 868:
        raise Phase1FA20ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA20ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A21_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT_AFTER_OWNER_APPROVAL":
        raise Phase1FA20ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "implementation_performed": False,
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
    except (Phase1FA20ValidationError, json.JSONDecodeError) as error:
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
