#!/usr/bin/env python3
"""Validate Phase 1E-A10 pure contract implementation security review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a10/pure-contract-implementation-security-review.json"
EXPECTED_SCHEMA = "pankster.phase1e-a10.pure-contract-implementation-security-review.v1"
EXPECTED_CONTENT_SHA = "b999e8f069d489b467ba8851c8dd04c5a2edf41bcc384fe6811e4f3cd09f6428"
EXPECTED_A8_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a8/implementation-approval-request.json"
EXPECTED_A8_EVIDENCE_SHA = "04b2ad216a04eb41e8042c1291f3a85d46855063d531741129072f85a8c2cb85"
EXPECTED_A8_CONTENT_SHA = "01a743c516d430a81e54d7785e6ca7db986969dd3d8ee0000250bd7e91d4e650"


class Phase1EA10ValidationError(RuntimeError):
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
        raise Phase1EA10ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA10ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA10ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA10ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA10ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA10ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA10ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA10ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A8_EVIDENCE) != EXPECTED_A8_EVIDENCE_SHA:
        raise Phase1EA10ValidationError("SOURCE_A8_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A8_EVIDENCE, "SOURCE_A8_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A8_CONTENT_SHA:
        raise Phase1EA10ValidationError("SOURCE_A8_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "READY_FOR_RUNTIME_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME":
        raise Phase1EA10ValidationError("VERDICT_INVALID")
    for field in (
        "deployment_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "model_api_calls_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
        "gateway_changes_approved",
        "dependency_changes_approved",
        "credential_migration_approved",
        "oauth_refresh_approved",
        "runtime_integration_approved",
    ):
        if content.get(field) is not False:
            raise Phase1EA10ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("implementation_performed") is not True:
        raise Phase1EA10ValidationError("IMPLEMENTATION_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != 12:
        raise Phase1EA10ValidationError("REVIEWED_FILES_INVALID")
    for item in reviewed:
        file_path = PROJECT_ROOT / item.get("path", "")
        if _sha256_file(file_path) != item.get("sha256"):
            raise Phase1EA10ValidationError("REVIEWED_FILE_SHA_MISMATCH", str(file_path))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1EA10ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1EA10ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("targeted_contract_tests", {}).get("result") != "PASS" or tests.get("targeted_contract_tests", {}).get("tests") != 31:
        raise Phase1EA10ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1e_a10_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1e_a10_validator_tests", {}).get("tests") != 5:
        raise Phase1EA10ValidationError("TARGETED_A10_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 500:
        raise Phase1EA10ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase1EA10ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1E_A11_RUNTIME_INTEGRATION_APPROVAL_REQUEST":
        raise Phase1EA10ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implementation_performed": True,
        "runtime_integration_approved": False,
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
    except (Phase1EA10ValidationError, json.JSONDecodeError) as error:
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
