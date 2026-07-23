#!/usr/bin/env python3
"""Validate Phase 1F-A26 versioned profile worker binding approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a26/versioned-profile-worker-binding-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a26.versioned-profile-worker-binding-approval-request.v1"
EXPECTED_CONTENT_SHA = "163fc0b33591319bec8a980ced0dc9a6a1a79a6de524bd8ae5a10b71d6fdc799"
EXPECTED_A25_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a25/versioned-gateway-binding-contract-review.json"
EXPECTED_A25_EVIDENCE_SHA = "7df8dc7f6de9561930e1f3927a405e5b2b5a39edce82912279a01e8d9fe45151"
EXPECTED_A25_CONTENT_SHA = "7bb87b1aa881fedc0c7ba2fafe2da88b857d54bafdb2f75e7df6f8de0efa87be"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A26_VERSIONED_PROFILE_WORKER_BINDING_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "b44cf12eef5e40ef6b515ecece47cb61eaf91e8c4e427a7ba57025b445cf473e"
EXPECTED_CONTRACT_CONTENT_SHA = "0c58baf2da38e215368478476b377edcfde5f9b68895201fec888b683a37795c"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_VERSIONED_PROFILE_WORKER_BINDING_CONTRACT:p1f-20260723-versionedprofileworkerbindinga26:0c58baf2da38e215368478476b377edcfde5f9b68895201fec888b683a37795c"
EXPECTED_APPROVAL_SHA = "35f1206ca19250d2298f540edd23e7d6d066caa2ccd8090c60bd1c5dc1987796"
EXPECTED_FUTURE_FILE_SCOPE = [
    "tools/pankster_runtime_security/profile_worker_binding_phase1f_contracts.py",
    "tools/tests/test_pankster_runtime_security_profile_worker_binding_phase1f_contracts.py",
]


class Phase1FA26ValidationError(RuntimeError):
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
        raise Phase1FA26ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA26ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA26ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA26ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA26ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA26ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA26ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA26ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A25_EVIDENCE) != EXPECTED_A25_EVIDENCE_SHA:
        raise Phase1FA26ValidationError("SOURCE_A25_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A25_EVIDENCE, "SOURCE_A25_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A25_CONTENT_SHA:
        raise Phase1FA26ValidationError("SOURCE_A25_CONTENT_SHA_UNEXPECTED")

    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA26ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA26ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA26ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA26ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA26ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA26ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA26ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA26ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA26ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_implementation") is not True:
        raise Phase1FA26ValidationError("APPROVAL_REQUIREMENT_INVALID")

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
            raise Phase1FA26ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA26ValidationError("APPROVAL_SCOPE_INVALID")
    allowed_true = {
        "disabled_by_default_versioned_profile_worker_binding_contract_allowed",
        "implementation_code_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
        "pure_contract_layer_only_allowed",
        "unit_tests_allowed",
        "versioned_profile_worker_binding_module_allowed",
    }
    for field in allowed_true:
        if scope.get(field) is not True:
            raise Phase1FA26ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in allowed_true and value is not False:
            raise Phase1FA26ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    if content.get("future_file_scope_allowlist") != EXPECTED_FUTURE_FILE_SCOPE:
        raise Phase1FA26ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    for field, value in content.get("required_future_integration_evidence", {}).items():
        if value is not True:
            raise Phase1FA26ValidationError("REQUIRED_FUTURE_EVIDENCE_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("phase_1f_a25_validator", {}).get("result") != "PASS":
        raise Phase1FA26ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    targeted = tests.get("targeted_approval_request_validator_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 5:
        raise Phase1FA26ValidationError("TARGETED_TEST_RESULT_INVALID")
    full = tests.get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 904:
        raise Phase1FA26ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA26ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A27_VERSIONED_PROFILE_WORKER_BINDING_CONTRACT_AFTER_OWNER_APPROVAL":
        raise Phase1FA26ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "implementation_performed": False,
        "runtime_execution_approved": False,
        "profile_worker_binding_approved": False,
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
    except (Phase1FA26ValidationError, json.JSONDecodeError) as error:
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
