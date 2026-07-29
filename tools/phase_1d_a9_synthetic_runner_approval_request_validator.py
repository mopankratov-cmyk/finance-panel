#!/usr/bin/env python3
"""Validate the Phase 1D-A9 synthetic runner approval request."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a9/synthetic-runner-execution-approval-request.json"
EXPECTED_SCHEMA = "pankster.phase1d-a9.synthetic-runner-execution-approval-request.v1"
EXPECTED_CONTENT_SHA = "ddaa61a507ffec2412fbe6cd1dc5bff5e326fd0f4a6b39664964b23f032d366d"
EXPECTED_A8_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a8/implementation-security-review.json"
EXPECTED_A8_EVIDENCE_SHA = "5a93d2d085864f0fdeae4f99d48da3353e7c711b8d006daff73ce7c0c8785422"
EXPECTED_A8_CONTENT_SHA = "3d48c143bbcb2ee6ec9d1a2e048986ace293b6963971109cb356ef05d3c7e334"
EXPECTED_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1D_A9_SYNTHETIC_RUNNER_EXECUTION_APPROVAL_REQUEST.ready.json"
EXPECTED_CONTRACT_FILE_SHA = "13b1636f08475183ba52b623d4d09981a53eb799f8d1bb93cd7c0a1755b9cc88"
EXPECTED_CONTRACT_CONTENT_SHA = "3a8b46a0703110942ce1733961c945746abb8ada04c1bde206f8a070c5182932"
EXPECTED_APPROVAL = "APPROVE_PHASE_1D_SYNTHETIC_RUNNER_PREFLIGHT_EXECUTION:p1d-20260723-syntheticpreflighta9:3a8b46a0703110942ce1733961c945746abb8ada04c1bde206f8a070c5182932"
EXPECTED_APPROVAL_SHA = "61daffefbea0b290e9c6cf693786fc8b295649086ea009b13414747ec84a4d79"


class Phase1DA9ValidationError(RuntimeError):
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
        raise Phase1DA9ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA9ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA9ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA9ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA9ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA9ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA9ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA9ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A8_EVIDENCE) != EXPECTED_A8_EVIDENCE_SHA:
        raise Phase1DA9ValidationError("SOURCE_A8_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A8_EVIDENCE, "SOURCE_A8_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A8_CONTENT_SHA:
        raise Phase1DA9ValidationError("SOURCE_A8_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_CONTRACT) != EXPECTED_CONTRACT_FILE_SHA:
        raise Phase1DA9ValidationError("CONTRACT_FILE_SHA_MISMATCH")
    contract = _load_json(EXPECTED_CONTRACT, "CONTRACT_MISSING")
    contract_content = contract.get("contract_content")
    if not isinstance(contract_content, dict):
        raise Phase1DA9ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1DA9ValidationError("CONTRACT_CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(contract_content)).hexdigest() != EXPECTED_CONTRACT_CONTENT_SHA:
        raise Phase1DA9ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")

    approval = content.get("owner_approval")
    if not isinstance(approval, dict):
        raise Phase1DA9ValidationError("OWNER_APPROVAL_INVALID")
    if approval.get("approval_command") != EXPECTED_APPROVAL:
        raise Phase1DA9ValidationError("APPROVAL_COMMAND_INVALID")
    if approval.get("approval_command_sha256") != EXPECTED_APPROVAL_SHA:
        raise Phase1DA9ValidationError("APPROVAL_SHA_INVALID")
    if hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1DA9ValidationError("APPROVAL_SHA_MISMATCH")
    if approval.get("approval_required_before_next_gate_execution") is not True:
        raise Phase1DA9ValidationError("APPROVAL_REQUIREMENT_INVALID")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved", "execution_performed"):
        if content.get(field) is not False:
            raise Phase1DA9ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("approval_scope")
    if not isinstance(scope, dict):
        raise Phase1DA9ValidationError("APPROVAL_SCOPE_INVALID")
    if scope.get("synthetic_only") is not True or scope.get("local_dry_run_only") is not True:
        raise Phase1DA9ValidationError("APPROVAL_SCOPE_POSITIVE_INVALID")
    for field, value in scope.items():
        if field not in {"synthetic_only", "local_dry_run_only"} and value is not False:
            raise Phase1DA9ValidationError("APPROVAL_SCOPE_FORBIDDEN_INVALID", field)
    tests = content.get("test_results", {}).get("targeted_approval_request_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA9ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A10_SYNTHETIC_RUNNER_PREFLIGHT_EXECUTION_AFTER_OWNER_APPROVAL":
        raise Phase1DA9ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "execution_performed": False,
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
    except (Phase1DA9ValidationError, json.JSONDecodeError) as error:
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
