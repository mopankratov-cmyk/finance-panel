#!/usr/bin/env python3
"""Validate Phase 1E-A7 independent security review before code evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a7/independent-security-review-before-code.json"
EXPECTED_SCHEMA = "pankster.phase1e-a7.independent-security-review-before-code.v1"
EXPECTED_CONTENT_SHA = "bfdcab7a00170ee6b84d88906e1e7257f678dfe821e62aca75ad520f502477c4"
EXPECTED_A6_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1e-a6/implementation-scope-lock.json"
EXPECTED_A6_EVIDENCE_SHA = "c92f9915f57169302c3dd35909bae5de6f9daa051fec3a529924bf5a44d74f3a"
EXPECTED_A6_CONTENT_SHA = "818a7334cf6694e04d0823206d159cd7e34117cab95f1dd9fc910bf39c421ad1"


class Phase1EA7ValidationError(RuntimeError):
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
        raise Phase1EA7ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1EA7ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1EA7ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1EA7ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1EA7ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1EA7ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1EA7ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1EA7ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A6_EVIDENCE) != EXPECTED_A6_EVIDENCE_SHA:
        raise Phase1EA7ValidationError("SOURCE_A6_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A6_EVIDENCE, "SOURCE_A6_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A6_CONTENT_SHA:
        raise Phase1EA7ValidationError("SOURCE_A6_CONTENT_SHA_UNEXPECTED")

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
        "implementation_code_approved",
    ):
        if content.get(field) is not False:
            raise Phase1EA7ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("verdict") != "READY_FOR_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE":
        raise Phase1EA7ValidationError("VERDICT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1EA7ValidationError("REQUIRED_CHANGES_NOT_EMPTY")

    chain = content.get("validated_gate_chain")
    expected_gates = ["1E-A0", "1E-A1", "1E-A2", "1E-A3", "1E-A4", "1E-A5", "1E-A6"]
    if not isinstance(chain, list) or [item.get("gate") for item in chain] != expected_gates:
        raise Phase1EA7ValidationError("VALIDATED_GATE_CHAIN_INVALID")
    if any(item.get("result") != "PASS" for item in chain):
        raise Phase1EA7ValidationError("VALIDATED_GATE_CHAIN_NOT_PASS")

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1EA7ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1EA7ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "no_dependency_or_lockfile_changes",
        "no_env_file_changes",
        "no_gateway_or_hermes_core_changes",
        "no_provider_or_model_api_calls_performed",
        "no_sandbox_profile_or_canary_started",
        "root_auth_fallback_not_approved",
        "oauth_refresh_materialization_not_approved",
        "fail_closed_behavior_required",
    ):
        if findings.get(field) is not True:
            raise Phase1EA7ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    controls = set(content.get("pre_code_required_controls", []))
    for item in (
        "implement only files in the 1E-A6 future code allowlist unless a new approval expands scope",
        "keep credential broker outputs as opaque references or per-attempt grants, never raw root credential pools",
        "require a separate exact owner approval before provider SDK use, real network call, sandbox launch, subprocess launch, OAuth refresh, or production profile execution",
    ):
        if item not in controls:
            raise Phase1EA7ValidationError("PRE_CODE_CONTROL_MISSING", item)
    residual = content.get("residual_risks")
    if not isinstance(residual, list) or len(residual) < 5:
        raise Phase1EA7ValidationError("RESIDUAL_RISKS_INVALID")

    tests = content.get("test_results", {})
    if tests.get("phase_1e_validator_chain", {}).get("validators") != 7 or tests.get("phase_1e_validator_chain", {}).get("result") != "PASS":
        raise Phase1EA7ValidationError("VALIDATOR_CHAIN_RESULT_INVALID")
    if tests.get("targeted_1e_a7_validator_tests", {}).get("tests") != 5 or tests.get("targeted_1e_a7_validator_tests", {}).get("result") != "PASS":
        raise Phase1EA7ValidationError("TARGETED_TEST_RESULT_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("tests") != 459 or tests.get("full_tools_unittest_discover", {}).get("result") != "PASS":
        raise Phase1EA7ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1E_A8_IMPLEMENTATION_APPROVAL_REQUEST":
        raise Phase1EA7ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "implementation_approved": False,
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
    except (Phase1EA7ValidationError, json.JSONDecodeError) as error:
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
