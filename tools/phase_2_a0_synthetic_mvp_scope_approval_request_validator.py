#!/usr/bin/env python3
"""Validate Phase 2-A0 synthetic MVP scope approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-2-a0/synthetic-mvp-scope-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase2-a0.synthetic-mvp-scope-approval-request.v1"
EXPECTED_CONTENT_SHA = "548a1179562ac808727d047b8847ca8b90a60cf6291df78306647461356caf2c"
EXPECTED_A26_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a26/versioned-profile-worker-binding-approval-request.json"
EXPECTED_A26_EVIDENCE_SHA = "96968d9dc8a6db01b6e54c2234683935c33815c70ff799d6b64921bcb3a69b6a"
EXPECTED_A26_CONTENT_SHA = "163fc0b33591319bec8a980ced0dc9a6a1a79a6de524bd8ae5a10b71d6fdc799"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_2_A0_SYNTHETIC_MVP_SCOPE_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "5043662bef7a4a653c2ebb68851b54d51f592c1668731ebcbae8f3244f951efd"
EXPECTED_CONTRACT_CONTENT_SHA = "4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96"
EXPECTED_APPROVAL = "APPROVE_PHASE_2_SYNTHETIC_MVP_IMPLEMENTATION:p2-20260723-syntheticmvpa0:4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96"
EXPECTED_APPROVAL_SHA = "8c559fd59bca0e3f0f499df142bf17ad548b54d9b7059ef02b5a25a4704c19ef"
EXPECTED_FUTURE_FILE_SCOPE = [
    "tools/pankster_runtime_security/synthetic_mvp_runner_contracts.py",
    "tools/tests/test_pankster_runtime_security_synthetic_mvp_runner_contracts.py",
]


class Phase2A0ValidationError(RuntimeError):
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
        raise Phase2A0ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase2A0ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase2A0ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase2A0ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase2A0ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase2A0ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase2A0ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase2A0ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A26_EVIDENCE) != EXPECTED_A26_EVIDENCE_SHA:
        raise Phase2A0ValidationError("SOURCE_A26_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A26_EVIDENCE, "SOURCE_A26_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A26_CONTENT_SHA:
        raise Phase2A0ValidationError("SOURCE_A26_CONTENT_SHA_UNEXPECTED")

    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase2A0ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase2A0ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase2A0ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase2A0ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase2A0ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase2A0ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase2A0ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase2A0ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase2A0ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase2A0ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in (
        "credential_migration_approved",
        "dependency_changes_approved",
        "deployment_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "implementation_performed",
        "model_api_calls_approved",
        "network_calls_approved",
        "oauth_refresh_approved",
        "production_profiles_approved",
        "profile_start_approved",
        "provider_api_calls_approved",
        "real_credentials_approved",
        "runtime_execution_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
    ):
        if content.get(field) is not False:
            raise Phase2A0ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase2A0ValidationError("APPROVAL_SCOPE_INVALID")
    allowed_true = {
        "code_execution_surface_fake_or_fail_closed_required",
        "delegate_task_surface_fake_or_fail_closed_required",
        "fake_credentials_only_required",
        "fake_model_broker_only_required",
        "implementation_code_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
        "mcp_surface_fake_or_fail_closed_required",
        "synthetic_only_mvp_allowed",
        "terminal_surface_fake_or_fail_closed_required",
        "unit_tests_allowed",
    }
    for field in allowed_true:
        if scope.get(field) is not True:
            raise Phase2A0ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in allowed_true and value is not False:
            raise Phase2A0ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    if content.get("future_file_scope_allowlist") != EXPECTED_FUTURE_FILE_SCOPE:
        raise Phase2A0ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    for field, value in content.get("required_future_integration_evidence", {}).items():
        if value is not True:
            raise Phase2A0ValidationError("REQUIRED_FUTURE_EVIDENCE_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("phase_1f_a26_validator", {}).get("result") != "PASS":
        raise Phase2A0ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    targeted = tests.get("targeted_approval_request_validator_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase2A0ValidationError("TARGETED_TEST_RESULT_INVALID")
    full = tests.get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 909:
        raise Phase2A0ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase2A0ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_2_A1_SYNTHETIC_ONLY_MVP_IMPLEMENTATION_AFTER_OWNER_APPROVAL":
        raise Phase2A0ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "implementation_performed": False,
        "synthetic_only": True,
        "runtime_execution_approved": False,
        "real_credentials_approved": False,
        "network_calls_approved": False,
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
    except (Phase2A0ValidationError, json.JSONDecodeError) as error:
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
