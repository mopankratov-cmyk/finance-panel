#!/usr/bin/env python3
"""Validate Phase 1E-A56 closeout approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a56/phase-closeout-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1e-a56.phase-closeout-approval-request.v1"
EXPECTED_CONTENT_SHA = "70884118220ccc9306c655caa33f7ea8d59020e48a78f20f921e62847c59ab87"
EXPECTED_A55_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a55/profile-runtime-readiness-gate-contract-review.json"
EXPECTED_A55_EVIDENCE_SHA = "45d8ae4b43be0971d7e66753bdb1d3159a77092f67400ffdb56137c3086f024d"
EXPECTED_A55_CONTENT_SHA = "1d4b15d32c020a89cbcb69911fe3311f9929b1aa8a91b9fae28f27093867d63b"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1E_A56_PHASE_CLOSEOUT_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "11e17ee4568dcb38314227930ff83c9604dd10f5d66669e0e2a0837cff42dc02"
EXPECTED_CONTRACT_CONTENT_SHA = "424d41217ff1884079f61de966513443af7c2561ae37f82d37fd45757b21df81"
EXPECTED_APPROVAL = "APPROVE_PHASE_1E_CLOSEOUT_PACKAGE:p1e-20260723-phase1ecloseouta56:424d41217ff1884079f61de966513443af7c2561ae37f82d37fd45757b21df81"
EXPECTED_APPROVAL_SHA = "22931320fb3d4e270d6a7711f68905f6edb765dfd0d0cf4730ec75160cd2d1fc"


class Phase1EA56ValidationError(RuntimeError):
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
        raise Phase1EA56ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA56ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA56ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA56ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA56ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA56ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA56ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA56ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A55_EVIDENCE) != EXPECTED_A55_EVIDENCE_SHA:
        raise Phase1EA56ValidationError("SOURCE_A55_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A55_EVIDENCE, "SOURCE_A55_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A55_CONTENT_SHA:
        raise Phase1EA56ValidationError("SOURCE_A55_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1EA56ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1EA56ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA56ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA56ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1EA56ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1EA56ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1EA56ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1EA56ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_integration") is not True:
        raise Phase1EA56ValidationError("APPROVAL_REQUIREMENT_INVALID")

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
            raise Phase1EA56ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1EA56ValidationError("APPROVAL_SCOPE_INVALID")
    positive_fields = {
        "phase_1e_closeout_package_allowed",
        "unit_tests_allowed",
        "local_static_validation_allowed",
        "local_unittest_allowed",
    }
    for field in positive_fields:
        if scope.get(field) is not True:
            raise Phase1EA56ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in positive_fields and value is not False:
            raise Phase1EA56ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)
    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "docs/program/PHASE_1E_CLOSEOUT_PACKAGE.md",
        "security/evidence/phase-1e-closeout/phase-1e-closeout-package.json",
        "tools/phase_1e_closeout_package_validator.py",
        "tools/tests/test_phase_1e_closeout_package_validator.py",
    ]:
        raise Phase1EA56ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA56ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A57_PHASE_CLOSEOUT_PACKAGE_AFTER_OWNER_APPROVAL":
        raise Phase1EA56ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA56ValidationError, json.JSONDecodeError) as error:
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
