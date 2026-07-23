#!/usr/bin/env python3
"""Validate the Phase 1D-A8 implementation security review evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a8/implementation-security-review.json"
EXPECTED_SCHEMA = "pankster.phase1d-a8.implementation-security-review.v1"
EXPECTED_CONTENT_SHA = "3d48c143bbcb2ee6ec9d1a2e048986ace293b6963971109cb356ef05d3c7e334"
EXPECTED_A7_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a7/synthetic-runner-preflight-contract.json"
EXPECTED_A7_EVIDENCE_SHA = "9eb81dd8fef0de9d5f8b10df27936d5986b75a1edde180832be0707c3eb1b28a"
EXPECTED_A7_CONTENT_SHA = "6c7f81b7d89118c9765360f734d1bbb8ffead126acedf4a8e8bc522f4a9b900f"


class Phase1DA8ValidationError(RuntimeError):
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
        raise Phase1DA8ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA8ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA8ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA8ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA8ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA8ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA8ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA8ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A7_EVIDENCE) != EXPECTED_A7_EVIDENCE_SHA:
        raise Phase1DA8ValidationError("SOURCE_A7_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A7_EVIDENCE, "SOURCE_A7_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A7_CONTENT_SHA:
        raise Phase1DA8ValidationError("SOURCE_A7_CONTENT_SHA_UNEXPECTED")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA8ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("verdict") != "READY_FOR_SYNTHETIC_EXECUTION_APPROVAL_REQUEST_NOT_EXECUTION":
        raise Phase1DA8ValidationError("VERDICT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1DA8ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1DA8ValidationError("SECURITY_FINDINGS_INVALID")
    expected_true = (
        "forbidden_file_scope_clean",
        "secret_value_scan_passed",
        "denylist_fixture_key_names_are_synthetic_only",
        "no_proxy_preservation_covered_by_tests",
        "fail_closed_defaults_covered_by_tests",
    )
    for field in expected_true:
        if findings.get(field) is not True:
            raise Phase1DA8ValidationError("SECURITY_FINDING_TRUE_INVALID", field)
    expected_false = (
        "dependency_or_lockfile_changes",
        "env_file_changes",
        "gateway_or_default_runtime_changes",
        "runtime_security_modules_read_process_environment",
        "runtime_security_modules_read_auth_json",
        "runtime_security_modules_read_keychain",
        "runtime_security_modules_use_network_clients",
        "runtime_security_modules_launch_subprocesses",
        "provider_or_model_api_calls_performed",
        "sandbox_or_profile_or_canary_started",
    )
    for field in expected_false:
        if findings.get(field) is not False:
            raise Phase1DA8ValidationError("SECURITY_FINDING_FALSE_INVALID", field)
    chain = content.get("validated_gate_chain")
    if not isinstance(chain, list) or [item.get("gate") for item in chain] != ["1D-A3", "1D-A4", "1D-A5", "1D-A6", "1D-A7"]:
        raise Phase1DA8ValidationError("VALIDATED_GATE_CHAIN_INVALID")
    if any(item.get("result") != "PASS" for item in chain):
        raise Phase1DA8ValidationError("VALIDATED_GATE_CHAIN_NOT_PASS")
    tests = content.get("test_results", {})
    if tests.get("phase_1d_validator_chain", {}).get("validators") != 5 or tests.get("phase_1d_validator_chain", {}).get("result") != "PASS":
        raise Phase1DA8ValidationError("VALIDATOR_CHAIN_RESULT_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("tests") != 388 or tests.get("full_tools_unittest_discover", {}).get("result") != "PASS":
        raise Phase1DA8ValidationError("FULL_TEST_RESULT_INVALID")
    if tests.get("targeted_a8_validator_tests", {}).get("tests") != 5 or tests.get("targeted_a8_validator_tests", {}).get("result") != "PASS":
        raise Phase1DA8ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A9_SYNTHETIC_RUNNER_EXECUTION_APPROVAL_REQUEST":
        raise Phase1DA8ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "execution_approved": False,
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
    except (Phase1DA8ValidationError, json.JSONDecodeError) as error:
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
