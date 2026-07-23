#!/usr/bin/env python3
"""Validate Phase 1F-A3 independent security review before code evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a3/independent-security-review-before-code.json"
EXPECTED_SCHEMA = "pankster.phase1f-a3.independent-security-review-before-code.v1"
EXPECTED_CONTENT_SHA = "2b2f87a7b14714f7ecee3c200067100ed01871a810c60671b340536c18ea0b28"
EXPECTED_A2_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a2/runtime-implementation-scope-lock.json"
EXPECTED_A2_EVIDENCE_SHA = "df1f400ea5b87ad14fe9e6f988b445c6a503d6180fe91af7412b4f579c075e33"
EXPECTED_A2_CONTENT_SHA = "7514aa9559a12d89793b9037922281e61d5233b88f94fd6d8b8852ac64ac485f"


class Phase1FA3ValidationError(RuntimeError):
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
        raise Phase1FA3ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA3ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA3ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA3ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA3ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA3ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA3ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA3ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A2_EVIDENCE) != EXPECTED_A2_EVIDENCE_SHA:
        raise Phase1FA3ValidationError("SOURCE_A2_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A2_EVIDENCE, "SOURCE_A2_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A2_CONTENT_SHA:
        raise Phase1FA3ValidationError("SOURCE_A2_CONTENT_SHA_UNEXPECTED")

    for field in (
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
        "implementation_code_approved",
        "runtime_execution_approved",
    ):
        if content.get(field) is not False:
            raise Phase1FA3ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("verdict") != "READY_FOR_PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE":
        raise Phase1FA3ValidationError("VERDICT_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA3ValidationError("REQUIRED_CHANGES_NOT_EMPTY")

    chain = content.get("validated_gate_chain")
    expected_gates = ["1F-A0", "1F-A1", "1F-A2"]
    if not isinstance(chain, list) or [item.get("gate") for item in chain] != expected_gates:
        raise Phase1FA3ValidationError("VALIDATED_GATE_CHAIN_INVALID")
    if any(item.get("result") != "PASS" for item in chain):
        raise Phase1FA3ValidationError("VALIDATED_GATE_CHAIN_NOT_PASS")

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1FA3ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1FA3ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "a2_diff_limited_to_docs_evidence_validator_and_tests",
        "a2_future_code_allowlist_is_narrow",
        "a2_requires_separate_a4_approval_before_implementation",
        "no_dependency_or_lockfile_changes",
        "no_env_file_changes",
        "no_gateway_web_server_profile_worker_or_hermes_core_changes",
        "no_provider_or_model_api_calls_performed",
        "no_runtime_process_subprocess_or_sandbox_launch_added",
        "root_auth_fallback_not_approved",
        "oauth_refresh_materialization_not_approved",
        "fail_closed_behavior_required",
    ):
        if findings.get(field) is not True:
            raise Phase1FA3ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    controls = set(content.get("pre_code_required_controls", []))
    for item in (
        "implementation may not begin until a separate exact Phase 1F-A4 owner approval is issued",
        "implement only files in the 1F-A2 future code allowlist unless a new approval expands scope",
        "do not add network clients, provider SDKs, subprocess launch, sandbox launch, or runtime process launch",
        "do not change gateway.py, web_server.py, profile worker runtime paths, Hermes core, app/lib runtime code, dependencies, or lockfiles",
    ):
        if item not in controls:
            raise Phase1FA3ValidationError("PRE_CODE_CONTROL_MISSING", item)
    residual = content.get("residual_risks")
    if not isinstance(residual, list) or len(residual) < 6:
        raise Phase1FA3ValidationError("RESIDUAL_RISKS_INVALID")

    tests = content.get("test_results", {})
    if tests.get("phase_1f_validator_chain", {}).get("validators") != 3 or tests.get("phase_1f_validator_chain", {}).get("result") != "PASS":
        raise Phase1FA3ValidationError("VALIDATOR_CHAIN_RESULT_INVALID")
    if tests.get("targeted_1f_a3_validator_tests", {}).get("tests") != 5 or tests.get("targeted_1f_a3_validator_tests", {}).get("result") != "PASS":
        raise Phase1FA3ValidationError("TARGETED_TEST_RESULT_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("tests") != 770 or tests.get("full_tools_unittest_discover", {}).get("result") != "PASS":
        raise Phase1FA3ValidationError("FULL_TEST_RESULT_INVALID")
    if content.get("next_gate") != "PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST":
        raise Phase1FA3ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "implementation_approved": False,
        "production_approved": False,
        "runtime_execution_approved": False,
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
    except (Phase1FA3ValidationError, json.JSONDecodeError) as error:
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
