#!/usr/bin/env python3
"""Validate Phase 1F-A10 versioned runtime adapter binding approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a10/versioned-runtime-adapter-binding-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1f-a10.versioned-runtime-adapter-binding-approval-request.v1"
EXPECTED_CONTENT_SHA = "ea9cb6efb3e1fa96e112a827c0165d132b5b0a9f0d6934ca7d23b2c8c4f97300"
EXPECTED_A9_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a9/versioned-runtime-integration-contract-review.json"
EXPECTED_A9_EVIDENCE_SHA = "a24e4bf7c91ceda7bcb6240173d0e42118f309d121cca813e5755767b7ee1ea2"
EXPECTED_A9_CONTENT_SHA = "2a153514b127dc2262abaf85fa9a3e24dd5a9df4ff983ec19d89217883af8d64"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "bb5cda5caa1eb4b6ac2a0875b399f98b8b06b2c02eeab38ac8c68c949ebac5b9"
EXPECTED_CONTRACT_CONTENT_SHA = "e26e2bf740fed79f90c56f4fbe13fe4efcab861c2b8faf2546877094bda000dc"
EXPECTED_APPROVAL = "APPROVE_PHASE_1F_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT:p1f-20260723-versionedadapterbindinga10:e26e2bf740fed79f90c56f4fbe13fe4efcab861c2b8faf2546877094bda000dc"
EXPECTED_APPROVAL_SHA = "f263bc157e01f321a277e2b99edc28e222b7f286586466fa157b1fd9857cd12c"
EXPECTED_FUTURE_FILE_SCOPE = [
    "docs/program/PHASE_1F_A11_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT_REVIEW.md",
    "security/evidence/phase-1f-a11/versioned-runtime-adapter-binding-contract-review.json",
    "tools/phase_1f_a11_versioned_runtime_adapter_binding_contract_review_validator.py",
    "tools/tests/test_phase_1f_a11_versioned_runtime_adapter_binding_contract_review_validator.py",
]


class Phase1FA10ValidationError(RuntimeError):
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
        raise Phase1FA10ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA10ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA10ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA10ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA10ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA10ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA10ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA10ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A9_EVIDENCE) != EXPECTED_A9_EVIDENCE_SHA:
        raise Phase1FA10ValidationError("SOURCE_A9_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A9_EVIDENCE, "SOURCE_A9_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A9_CONTENT_SHA:
        raise Phase1FA10ValidationError("SOURCE_A9_CONTENT_SHA_UNEXPECTED")

    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1FA10ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1FA10ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA10ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA10ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1FA10ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1FA10ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1FA10ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1FA10ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1FA10ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_binding_review") is not True:
        raise Phase1FA10ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in (
        "binding_performed",
        "credential_migration_approved",
        "dependency_changes_approved",
        "deployment_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "model_api_calls_approved",
        "oauth_refresh_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "runtime_execution_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
    ):
        if content.get(field) is not False:
            raise Phase1FA10ValidationError(f"{field.upper()}_NOT_FALSE")

    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1FA10ValidationError("APPROVAL_SCOPE_INVALID")
    allowed_true = {
        "runtime_adapter_binding_contract_review_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
    }
    for field in allowed_true:
        if scope.get(field) is not True:
            raise Phase1FA10ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in allowed_true and value is not False:
            raise Phase1FA10ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)

    if content.get("future_file_scope_allowlist") != EXPECTED_FUTURE_FILE_SCOPE:
        raise Phase1FA10ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1FA10ValidationError("TARGETED_TEST_RESULT_INVALID")
    full = content.get("test_results", {}).get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 812:
        raise Phase1FA10ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA10ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A11_VERSIONED_RUNTIME_ADAPTER_BINDING_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL":
        raise Phase1FA10ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "binding_performed": False,
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
    except (Phase1FA10ValidationError, json.JSONDecodeError) as error:
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
