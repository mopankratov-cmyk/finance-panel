#!/usr/bin/env python3
"""Validate Phase 1F-A11 versioned runtime adapter binding contract review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a11/versioned-runtime-adapter-binding-contract-review.json"
EXPECTED_SCHEMA = "pankster.phase1f-a11.versioned-runtime-adapter-binding-contract-review.v1"
EXPECTED_CONTENT_SHA = "1a20cd9ea4d7b08346318dfd4365f6524d74b68de467949da3975cfb1f16f4dc"
EXPECTED_A10_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a10/versioned-runtime-adapter-binding-approval-request.json"
EXPECTED_A10_EVIDENCE_SHA = "ce5584d486900f36b4bb954ef6ceaa37682dc6a697b7346c567bdd788f389ec1"
EXPECTED_A10_CONTENT_SHA = "ea9cb6efb3e1fa96e112a827c0165d132b5b0a9f0d6934ca7d23b2c8c4f97300"
EXPECTED_A10_APPROVAL_SHA = "f263bc157e01f321a277e2b99edc28e222b7f286586466fa157b1fd9857cd12c"
EXPECTED_REVIEWED_FILES = [
    ("tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py", "26db685069202484fcfab5f11c2f89638382b66cacbc6e43752463e11f73ff6f"),
    ("tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py", "03ca5a43142d193bd69db8d26c0834a3cd2459bf43f2443a8f6897fa599e2c14"),
]


class Phase1FA11ValidationError(RuntimeError):
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
        raise Phase1FA11ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA11ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA11ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA11ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA11ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA11ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA11ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA11ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A10_EVIDENCE) != EXPECTED_A10_EVIDENCE_SHA:
        raise Phase1FA11ValidationError("SOURCE_A10_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A10_EVIDENCE, "SOURCE_A10_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A10_CONTENT_SHA:
        raise Phase1FA11ValidationError("SOURCE_A10_CONTENT_SHA_UNEXPECTED")
    source_approval = source.get("decision_content", {}).get("owner_approval", {})
    if source_approval.get("approval_command_sha256") != EXPECTED_A10_APPROVAL_SHA:
        raise Phase1FA11ValidationError("SOURCE_A10_APPROVAL_SHA_UNEXPECTED")

    if content.get("verdict") != "READY_FOR_PHASE_1F_A12_VERSIONED_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME":
        raise Phase1FA11ValidationError("VERDICT_INVALID")
    for field in (
        "credential_migration_approved",
        "dependency_changes_approved",
        "deployment_approved",
        "gateway_changes_approved",
        "hermes_core_changes_approved",
        "model_api_calls_approved",
        "oauth_refresh_approved",
        "production_profiles_approved",
        "provider_api_calls_approved",
        "runtime_execution_approved",
        "sandbox_execution_approved",
        "subprocess_launch_approved",
    ):
        if content.get(field) is not False:
            raise Phase1FA11ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("binding_contract_review_performed") is not True:
        raise Phase1FA11ValidationError("BINDING_CONTRACT_REVIEW_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != len(EXPECTED_REVIEWED_FILES):
        raise Phase1FA11ValidationError("REVIEWED_FILES_INVALID")
    expected_paths = [path for path, _sha in EXPECTED_REVIEWED_FILES]
    if [item.get("path") for item in reviewed] != expected_paths:
        raise Phase1FA11ValidationError("REVIEWED_FILE_PATHS_INVALID")
    for expected_path, expected_sha in EXPECTED_REVIEWED_FILES:
        if _sha256_file(PROJECT_ROOT / expected_path) != expected_sha:
            raise Phase1FA11ValidationError("REVIEWED_FILE_SHA_MISMATCH", expected_path)
    for item, (_expected_path, expected_sha) in zip(reviewed, EXPECTED_REVIEWED_FILES):
        if item.get("sha256") != expected_sha:
            raise Phase1FA11ValidationError("REVIEWED_FILE_EVIDENCE_SHA_INVALID", item.get("path"))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1FA11ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1FA11ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "a10_exact_owner_approval_verified",
        "a11_artifacts_match_a10_allowlist",
        "reviewed_files_match_versioned_adapter_binding_scope",
        "phase_1e_hash_pinned_files_preserved",
        "binding_remains_disabled_by_default",
        "binding_manifest_secret_free",
        "adapter_identity_capability_validation_present",
        "contract_layer_only",
        "no_auth_json_or_keychain_reads",
        "no_credential_materialization",
        "no_gateway_web_server_profile_worker_or_hermes_core_changes",
        "no_network_clients",
        "no_provider_or_model_api_calls",
        "no_runtime_binding",
        "no_runtime_process_start",
        "no_sandbox_launch",
        "no_subprocess_launch",
    ):
        if findings.get(field) is not True:
            raise Phase1FA11ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    tests = content.get("test_results", {})
    if tests.get("phase_1f_a10_validator", {}).get("result") != "PASS":
        raise Phase1FA11ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    targeted = tests.get("targeted_versioned_adapter_binding_contract_tests", {})
    if targeted.get("result") != "PASS" or targeted.get("tests") != 6:
        raise Phase1FA11ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1f_a11_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1f_a11_validator_tests", {}).get("tests") != 5:
        raise Phase1FA11ValidationError("TARGETED_A11_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 817:
        raise Phase1FA11ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA11ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A12_VERSIONED_HOST_ADAPTER_INTEGRATION_APPROVAL_REQUEST":
        raise Phase1FA11ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "binding_contract_review_performed": True,
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
    except (Phase1FA11ValidationError, json.JSONDecodeError) as error:
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
