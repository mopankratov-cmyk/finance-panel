#!/usr/bin/env python3
"""Validate Phase 1E-A13 disabled runtime integration contract review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a13/disabled-runtime-integration-contract-review.json"
EXPECTED_SCHEMA = "pankster.phase1e-a13.disabled-runtime-integration-contract-review.v1"
EXPECTED_CONTENT_SHA = "dc6458b62972a8075bf9394bf9a2755d7f4ebe6f86a13e839eb6c512ccea57b5"
EXPECTED_A11_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a11/runtime-integration-approval-request.json"
EXPECTED_A11_EVIDENCE_SHA = "65c94bc3e1b8eced7a37151b0e554425c6de4fc91d8c87f63dfe3ae6f2c4d316"
EXPECTED_A11_CONTENT_SHA = "c1fa810dd6c566da324362fb2715bee1ba0bebcca164ce1899c6315e108f9624"


class Phase1EA13ValidationError(RuntimeError):
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
        raise Phase1EA13ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA13ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA13ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA13ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA13ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA13ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA13ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA13ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A11_EVIDENCE) != EXPECTED_A11_EVIDENCE_SHA:
        raise Phase1EA13ValidationError("SOURCE_A11_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A11_EVIDENCE, "SOURCE_A11_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A11_CONTENT_SHA:
        raise Phase1EA13ValidationError("SOURCE_A11_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "READY_FOR_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME":
        raise Phase1EA13ValidationError("VERDICT_INVALID")
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
            raise Phase1EA13ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("integration_contract_performed") is not True:
        raise Phase1EA13ValidationError("INTEGRATION_CONTRACT_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != 2:
        raise Phase1EA13ValidationError("REVIEWED_FILES_INVALID")
    for item in reviewed:
        file_path = PROJECT_ROOT / item.get("path", "")
        if _sha256_file(file_path) != item.get("sha256"):
            raise Phase1EA13ValidationError("REVIEWED_FILE_SHA_MISMATCH", str(file_path))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1EA13ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1EA13ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    tests = content.get("test_results", {})
    if tests.get("targeted_runtime_integration_contract_tests", {}).get("result") != "PASS" or tests.get("targeted_runtime_integration_contract_tests", {}).get("tests") != 6:
        raise Phase1EA13ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1e_a13_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1e_a13_validator_tests", {}).get("tests") != 5:
        raise Phase1EA13ValidationError("TARGETED_A13_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 516:
        raise Phase1EA13ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase1EA13ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1E_A14_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST":
        raise Phase1EA13ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "integration_contract_performed": True,
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
    except (Phase1EA13ValidationError, json.JSONDecodeError) as error:
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
