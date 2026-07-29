#!/usr/bin/env python3
"""Validate Phase 1E-A17 host adapter integration approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a17/host-adapter-integration-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1e-a17.host-adapter-integration-approval-request.v1"
EXPECTED_CONTENT_SHA = "68682ce1e641fde5e0c88e51fd1a72d76bf04736325f925f63705636c7b40835"
EXPECTED_A16_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a16/runtime-adapter-binding-contract-review.json"
EXPECTED_A16_EVIDENCE_SHA = "0bc08b6682b5c4e2446e5fb9827e2afc33a15f4c54e62232891f1647f6eafdef"
EXPECTED_A16_CONTENT_SHA = "b828543b31fa892db67fc302eb7d5c3bb6ea7d8f14dbd326d65663540f876d1b"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1E_A17_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "e9878cb2b247c65ee9130a534f186cde21529283af0846f68363e7fbef66d88c"
EXPECTED_CONTRACT_CONTENT_SHA = "d67533a02d14e2fd91c2145882b1fe42c94b265b695759d4a9d256661753aeb1"
EXPECTED_APPROVAL = "APPROVE_PHASE_1E_HOST_ADAPTER_INTEGRATION_CONTRACT:p1e-20260723-hostadaptera17:d67533a02d14e2fd91c2145882b1fe42c94b265b695759d4a9d256661753aeb1"
EXPECTED_APPROVAL_SHA = "da3dcc1c271d01d33251703410d2cf35169be5e51805a55d2038bdffd75685e4"


class Phase1EA17ValidationError(RuntimeError):
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
        raise Phase1EA17ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA17ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA17ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA17ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA17ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA17ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA17ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA17ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A16_EVIDENCE) != EXPECTED_A16_EVIDENCE_SHA:
        raise Phase1EA17ValidationError("SOURCE_A16_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A16_EVIDENCE, "SOURCE_A16_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A16_CONTENT_SHA:
        raise Phase1EA17ValidationError("SOURCE_A16_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1EA17ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1EA17ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA17ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1EA17ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1EA17ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1EA17ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1EA17ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1EA17ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_integration") is not True:
        raise Phase1EA17ValidationError("APPROVAL_REQUIREMENT_INVALID")

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
            raise Phase1EA17ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1EA17ValidationError("APPROVAL_SCOPE_INVALID")
    for field in ("disabled_by_default_host_adapter_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"):
        if scope.get(field) is not True:
            raise Phase1EA17ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID", field)
    for field, value in scope.items():
        if field not in {"disabled_by_default_host_adapter_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"} and value is not False:
            raise Phase1EA17ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)
    allowlist = content.get("future_file_scope_allowlist")
    if allowlist != [
        "tools/pankster_runtime_security/host_adapter_integration_contracts.py",
        "tools/tests/test_pankster_runtime_security_host_adapter_integration_contracts.py",
    ]:
        raise Phase1EA17ValidationError("FUTURE_FILE_SCOPE_ALLOWLIST_INVALID")
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1EA17ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A18_HOST_ADAPTER_INTEGRATION_CONTRACT_AFTER_OWNER_APPROVAL":
        raise Phase1EA17ValidationError("NEXT_GATE_INVALID")

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
    except (Phase1EA17ValidationError, json.JSONDecodeError) as error:
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
