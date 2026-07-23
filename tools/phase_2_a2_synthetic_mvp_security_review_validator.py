#!/usr/bin/env python3
"""Validate Phase 2-A2 synthetic MVP security review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-2-a2/synthetic-mvp-security-review.json"
EXPECTED_SCHEMA = "pankster.phase2-a2.synthetic-mvp-security-review.v1"
EXPECTED_CONTENT_SHA = "ba70a5eee8f53c97028e02a840fbe0f0c8e5af569e42d9e22c2ee4ecbc3ca1c3"
EXPECTED_A0_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-2-a0/synthetic-mvp-scope-approval-request.json"
EXPECTED_A0_EVIDENCE_SHA = "9528d9e1cb976d0a406872b80eacccbb2fff3b9ccdd6af74196fd028905392d7"
EXPECTED_A0_CONTENT_SHA = "548a1179562ac808727d047b8847ca8b90a60cf6291df78306647461356caf2c"
EXPECTED_A0_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_2_A0_SYNTHETIC_MVP_SCOPE_APPROVAL_REQUEST.ready.json"
EXPECTED_A0_CONTRACT_SHA = "5043662bef7a4a653c2ebb68851b54d51f592c1668731ebcbae8f3244f951efd"
EXPECTED_A0_CONTRACT_CONTENT_SHA = "4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96"
EXPECTED_A0_APPROVAL_SHA = "8c559fd59bca0e3f0f499df142bf17ad548b54d9b7059ef02b5a25a4704c19ef"
EXPECTED_REVIEWED_HEAD = "711bd800"
EXPECTED_REVIEWED_COMMIT = "711bd800ac89f7691f44343b2913eff3c471f0be"
EXPECTED_REVIEWED_RANGE = "5ea07c20..711bd800"
EXPECTED_REVIEWED_FILES = [
    (
        "tools/pankster_runtime_security/synthetic_mvp_runner_contracts.py",
        "deba594d0ea819b3ba58e82d892fa1550f8d0d5b9f0f664b1f7fad813dc2427b",
    ),
    (
        "tools/tests/test_pankster_runtime_security_synthetic_mvp_runner_contracts.py",
        "fc6a1269e4fbb8c0219593be3751697f5d5356d330b6082449b300bc3ecaf979",
    ),
]


class Phase2A2ValidationError(RuntimeError):
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
        raise Phase2A2ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase2A2ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase2A2ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase2A2ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase2A2ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase2A2ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase2A2ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase2A2ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A0_EVIDENCE) != EXPECTED_A0_EVIDENCE_SHA:
        raise Phase2A2ValidationError("SOURCE_A0_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A0_EVIDENCE, "SOURCE_A0_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A0_CONTENT_SHA:
        raise Phase2A2ValidationError("SOURCE_A0_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_A0_CONTRACT) != EXPECTED_A0_CONTRACT_SHA:
        raise Phase2A2ValidationError("SOURCE_A0_CONTRACT_SHA_MISMATCH")
    contract = _load_json(EXPECTED_A0_CONTRACT, "SOURCE_A0_CONTRACT_MISSING")
    if contract.get("content_sha256") != EXPECTED_A0_CONTRACT_CONTENT_SHA:
        raise Phase2A2ValidationError("SOURCE_A0_CONTRACT_CONTENT_SHA_UNEXPECTED")
    if content.get("source_evidence", {}).get("phase_2_a0_approval_command_sha256") != EXPECTED_A0_APPROVAL_SHA:
        raise Phase2A2ValidationError("SOURCE_A0_APPROVAL_SHA_INVALID")

    if content.get("reviewed_head") != EXPECTED_REVIEWED_HEAD:
        raise Phase2A2ValidationError("REVIEWED_HEAD_INVALID")
    if content.get("reviewed_commit") != EXPECTED_REVIEWED_COMMIT:
        raise Phase2A2ValidationError("REVIEWED_COMMIT_INVALID")
    if content.get("reviewed_range") != EXPECTED_REVIEWED_RANGE:
        raise Phase2A2ValidationError("REVIEWED_RANGE_INVALID")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != len(EXPECTED_REVIEWED_FILES):
        raise Phase2A2ValidationError("REVIEWED_FILES_INVALID")
    if [item.get("path") for item in reviewed] != [path for path, _sha in EXPECTED_REVIEWED_FILES]:
        raise Phase2A2ValidationError("REVIEWED_FILE_PATHS_INVALID")
    for expected_path, expected_sha in EXPECTED_REVIEWED_FILES:
        if _sha256_file(PROJECT_ROOT / expected_path) != expected_sha:
            raise Phase2A2ValidationError("REVIEWED_FILE_SHA_MISMATCH", expected_path)
    for item, (_expected_path, expected_sha) in zip(reviewed, EXPECTED_REVIEWED_FILES):
        if item.get("sha256") != expected_sha:
            raise Phase2A2ValidationError("REVIEWED_FILE_EVIDENCE_SHA_INVALID", item.get("path"))

    for field in (
        "auth_file_reads_approved",
        "canary_approved",
        "credential_migration_approved",
        "dependency_changes_approved",
        "deployment_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "keychain_reads_approved",
        "model_api_calls_approved",
        "network_calls_approved",
        "oauth_refresh_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "real_credentials_approved",
        "runtime_execution_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
    ):
        if content.get(field) is not False:
            raise Phase2A2ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("implementation_performed") is not True:
        raise Phase2A2ValidationError("IMPLEMENTATION_PERFORMED_NOT_TRUE")

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase2A2ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase2A2ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "a0_exact_owner_approval_verified",
        "changed_files_match_a0_allowlist",
        "pure_in_memory_contract_layer_only",
        "disabled_by_default_present",
        "exact_approval_token_required",
        "fake_credentials_only",
        "fake_model_broker_only",
        "sanitized_environment_required",
        "no_proxy_preserved",
        "mandatory_sensitive_environment_denylist_enforced",
        "terminal_surface_fake_or_fail_closed",
        "code_execution_surface_fake_or_fail_closed",
        "delegate_task_surface_fake_or_fail_closed",
        "mcp_surface_fake_or_fail_closed",
        "no_auth_json_or_keychain_reads",
        "no_credential_materialization",
        "no_network_clients",
        "no_provider_or_model_api_calls",
        "no_runtime_execution",
        "no_subprocess_launch",
        "no_sandbox_launch",
    ):
        if findings.get(field) is not True:
            raise Phase2A2ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    tests = content.get("test_results", {})
    if tests.get("phase_2_a0_validator", {}).get("result") != "PASS":
        raise Phase2A2ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    targeted = tests.get("targeted_synthetic_mvp_contract_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 13:
        raise Phase2A2ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    validator_tests = tests.get("targeted_2a2_validator_tests", {})
    if validator_tests.get("result") != "PASS" or validator_tests.get("tests") != 5:
        raise Phase2A2ValidationError("TARGETED_A2_TESTS_INVALID")
    full = tests.get("full_tools_unittest_discover", {})
    if full.get("result") != "PASS" or full.get("tests") != 927:
        raise Phase2A2ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase2A2ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("verdict") != "PHASE_2_SYNTHETIC_MVP_COMPLETE_NOT_PRODUCTION_READY":
        raise Phase2A2ValidationError("VERDICT_INVALID")
    if content.get("next_gate") != "PHASE_2_SYNTHETIC_MVP_COMPLETE_STOP_OR_SEPARATE_OWNER_APPROVAL_FOR_PRODUCTION_ARCHITECTURE":
        raise Phase2A2ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implementation_performed": True,
        "runtime_execution_approved": False,
        "real_credentials_approved": False,
        "network_calls_approved": False,
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
    except (Phase2A2ValidationError, json.JSONDecodeError) as error:
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
