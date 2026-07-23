#!/usr/bin/env python3
"""Validate Phase 1F-A13 versioned host adapter integration contract review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a13/versioned-host-adapter-integration-contract-review.json"
EXPECTED_SCHEMA = "pankster.phase1f-a13.versioned-host-adapter-integration-contract-review.v1"
EXPECTED_CONTENT_SHA = "78d220339440da834459b365d302f4eb6f84e50365a2e721c9f5be189a9d6a26"
EXPECTED_A12_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a12/versioned-host-adapter-integration-approval-request.json"
EXPECTED_A12_EVIDENCE_SHA = "3d44789579d905a4b21ecc41804eb41abeee9cc845e07518f762114702804b93"
EXPECTED_A12_CONTENT_SHA = "0702ab66ffa88d3c5ef589e454fb74b41ea9da9e972e1cb7376b59b577216ea7"
EXPECTED_A12_APPROVAL_SHA = "bb620fda06f51261fec93d288ef8c09e6aad1c137057cd4eb0bc992ccd9211a6"
EXPECTED_REVIEWED_FILES = [
    ("tools/pankster_runtime_security/host_adapter_integration_contracts.py", "2137033ad7521e4650e55b2e1f98d4fb4e248dd057a14a87f96e0c4a2854c9d7"),
    ("tools/tests/test_pankster_runtime_security_host_adapter_integration_contracts.py", "1ca51d9762d6aa872521e5126125a44a6de45a1926f68712a5c7d4aa18bc3d47"),
]


class Phase1FA13ValidationError(RuntimeError):
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
        raise Phase1FA13ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA13ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA13ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA13ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA13ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA13ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA13ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA13ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A12_EVIDENCE) != EXPECTED_A12_EVIDENCE_SHA:
        raise Phase1FA13ValidationError("SOURCE_A12_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A12_EVIDENCE, "SOURCE_A12_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A12_CONTENT_SHA:
        raise Phase1FA13ValidationError("SOURCE_A12_CONTENT_SHA_UNEXPECTED")
    source_approval = source.get("decision_content", {}).get("owner_approval", {})
    if source_approval.get("approval_command_sha256") != EXPECTED_A12_APPROVAL_SHA:
        raise Phase1FA13ValidationError("SOURCE_A12_APPROVAL_SHA_UNEXPECTED")

    if content.get("verdict") != "REVISION_REQUIRED_BEFORE_PHASE_1F_HOST_RUNTIME_EXECUTION_VERSIONED_HOST_ADAPTER_LAYER_MISSING":
        raise Phase1FA13ValidationError("VERDICT_INVALID")
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
            raise Phase1FA13ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("host_adapter_contract_review_performed") is not True:
        raise Phase1FA13ValidationError("HOST_ADAPTER_CONTRACT_REVIEW_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != len(EXPECTED_REVIEWED_FILES):
        raise Phase1FA13ValidationError("REVIEWED_FILES_INVALID")
    expected_paths = [path for path, _sha in EXPECTED_REVIEWED_FILES]
    if [item.get("path") for item in reviewed] != expected_paths:
        raise Phase1FA13ValidationError("REVIEWED_FILE_PATHS_INVALID")
    for expected_path, expected_sha in EXPECTED_REVIEWED_FILES:
        if _sha256_file(PROJECT_ROOT / expected_path) != expected_sha:
            raise Phase1FA13ValidationError("REVIEWED_FILE_SHA_MISMATCH", expected_path)
    for item, (_expected_path, expected_sha) in zip(reviewed, EXPECTED_REVIEWED_FILES):
        if item.get("sha256") != expected_sha:
            raise Phase1FA13ValidationError("REVIEWED_FILE_EVIDENCE_SHA_INVALID", item.get("path"))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1FA13ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1FA13ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "a12_exact_owner_approval_verified",
        "a13_artifacts_match_a12_allowlist",
        "base_host_adapter_contract_reviewed",
        "base_host_adapter_contract_disabled_by_default",
        "base_host_manifest_secret_free",
        "phase_1f_versioned_host_adapter_module_absent",
        "phase_1f_versioned_host_adapter_tests_absent",
        "no_auth_json_or_keychain_reads",
        "no_credential_materialization",
        "no_gateway_web_server_profile_worker_or_hermes_core_changes",
        "no_network_clients",
        "no_provider_or_model_api_calls",
        "no_runtime_integration",
        "no_runtime_process_start",
        "no_sandbox_launch",
        "no_subprocess_launch",
    ):
        if findings.get(field) is not True:
            raise Phase1FA13ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    required = content.get("required_changes")
    if not isinstance(required, list) or len(required) != 2:
        raise Phase1FA13ValidationError("REQUIRED_CHANGES_INVALID")
    tests = content.get("test_results", {})
    if tests.get("phase_1f_a12_validator", {}).get("result") != "PASS":
        raise Phase1FA13ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    if tests.get("targeted_base_host_adapter_contract_tests", {}).get("result") != "PASS" or tests.get("targeted_base_host_adapter_contract_tests", {}).get("tests") != 6:
        raise Phase1FA13ValidationError("TARGETED_BASE_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1f_a13_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1f_a13_validator_tests", {}).get("tests") != 5:
        raise Phase1FA13ValidationError("TARGETED_A13_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 827:
        raise Phase1FA13ValidationError("FULL_TESTS_INVALID")
    if content.get("next_gate") != "PHASE_1F_A14_VERSIONED_HOST_ADAPTER_IMPLEMENTATION_APPROVAL_REQUEST":
        raise Phase1FA13ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "host_adapter_contract_review_performed": True,
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
    except (Phase1FA13ValidationError, json.JSONDecodeError) as error:
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
