#!/usr/bin/env python3
"""Validate Phase 1E-A28 gateway binding contract review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a28/gateway-binding-contract-review.json"
EXPECTED_SCHEMA = "pankster.phase1e-a28.gateway-binding-contract-review.v1"
EXPECTED_CONTENT_SHA = "fde42871aa47f7c2ae5ece386999de72f33e9a90ff4f2ad3dd83289e4df3f887"
EXPECTED_A26_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a26/gateway-binding-approval-request.json"
EXPECTED_A26_EVIDENCE_SHA = "b255a966c704f629c33c8898fd1442540d5445b175f03493ef3be97f2ad18011"
EXPECTED_A26_CONTENT_SHA = "f4cb4be155195aae23031675fdb216c97dd3f1e2c7a6cf7d5d36cb3a6d69987e"


class Phase1EA28ValidationError(RuntimeError):
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
        raise Phase1EA28ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA28ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA28ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA28ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA28ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA28ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA28ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA28ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A26_EVIDENCE) != EXPECTED_A26_EVIDENCE_SHA:
        raise Phase1EA28ValidationError("SOURCE_A26_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A26_EVIDENCE, "SOURCE_A26_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A26_CONTENT_SHA:
        raise Phase1EA28ValidationError("SOURCE_A26_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "READY_FOR_PROFILE_WORKER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME":
        raise Phase1EA28ValidationError("VERDICT_INVALID")
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
    ):
        if content.get(field) is not False:
            raise Phase1EA28ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("gateway_binding_contract_performed") is not True:
        raise Phase1EA28ValidationError("GATEWAY_BINDING_CONTRACT_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != 2:
        raise Phase1EA28ValidationError("REVIEWED_FILES_INVALID")
    for item in reviewed:
        file_path = PROJECT_ROOT / item.get("path", "")
        if _sha256_file(file_path) != item.get("sha256"):
            raise Phase1EA28ValidationError("REVIEWED_FILE_SHA_MISMATCH", str(file_path))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1EA28ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1EA28ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("targeted_gateway_binding_contract_tests", {}).get("result") != "PASS" or tests.get("targeted_gateway_binding_contract_tests", {}).get("tests") != 6:
        raise Phase1EA28ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1e_a28_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1e_a28_validator_tests", {}).get("tests") != 5:
        raise Phase1EA28ValidationError("TARGETED_A28_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 596:
        raise Phase1EA28ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase1EA28ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1E_A29_PROFILE_WORKER_BINDING_APPROVAL_REQUEST":
        raise Phase1EA28ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "gateway_binding_contract_performed": True,
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
    except (Phase1EA28ValidationError, json.JSONDecodeError) as error:
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
