#!/usr/bin/env python3
"""Validate Phase 1F-A22 versioned host runtime wiring contract review."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a22/versioned-host-runtime-wiring-contract-review.json"
EXPECTED_SCHEMA = "pankster.phase1f-a22.versioned-host-runtime-wiring-contract-review.v1"
EXPECTED_CONTENT_SHA = "7eefbec3c0264a8bd1a366535b6127e3b369485811ef82e8df165a9d05774aa4"
EXPECTED_A20_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1f-a20/versioned-host-runtime-wiring-approval-request.json"
EXPECTED_A20_EVIDENCE_SHA = "d0cc2e5d01241753bd0ca2f7d7de6eaf69972147fa94194c075aacdbce276e16"
EXPECTED_A20_CONTENT_SHA = "d8749e4d31c3ccf7c1d4f3f128878d9a5e011d62736ec15fa60d9256208fda43"
EXPECTED_REVIEWED_FILES = [
    ("tools/pankster_runtime_security/host_runtime_wiring_phase1f_contracts.py", "1f9af1bac9727cb1c90b982a0fd6c161bc77b9591175da7612d474324830d1f2"),
    ("tools/tests/test_pankster_runtime_security_host_runtime_wiring_phase1f_contracts.py", "8733ac198a3cc8dee964ed853bd3b367f351e16c9a4d6824eedec9b511a91dcd"),
]


class Phase1FA22ValidationError(RuntimeError):
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
        raise Phase1FA22ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1FA22ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1FA22ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1FA22ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1FA22ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1FA22ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1FA22ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1FA22ValidationError("CONTENT_SHA_MISMATCH")

    if _sha256_file(EXPECTED_A20_EVIDENCE) != EXPECTED_A20_EVIDENCE_SHA:
        raise Phase1FA22ValidationError("SOURCE_A20_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A20_EVIDENCE, "SOURCE_A20_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A20_CONTENT_SHA:
        raise Phase1FA22ValidationError("SOURCE_A20_CONTENT_SHA_UNEXPECTED")

    if content.get("verdict") != "READY_FOR_PHASE_1F_A23_VERSIONED_GATEWAY_BINDING_APPROVAL_REQUEST_NOT_RUNTIME":
        raise Phase1FA22ValidationError("VERDICT_INVALID")
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
            raise Phase1FA22ValidationError(f"{field.upper()}_NOT_FALSE")
    if content.get("implementation_performed") is not True:
        raise Phase1FA22ValidationError("IMPLEMENTATION_PERFORMED_NOT_TRUE")

    reviewed = content.get("reviewed_files")
    if not isinstance(reviewed, list) or len(reviewed) != len(EXPECTED_REVIEWED_FILES):
        raise Phase1FA22ValidationError("REVIEWED_FILES_INVALID")
    if [item.get("path") for item in reviewed] != [path for path, _sha in EXPECTED_REVIEWED_FILES]:
        raise Phase1FA22ValidationError("REVIEWED_FILE_PATHS_INVALID")
    for expected_path, expected_sha in EXPECTED_REVIEWED_FILES:
        if _sha256_file(PROJECT_ROOT / expected_path) != expected_sha:
            raise Phase1FA22ValidationError("REVIEWED_FILE_SHA_MISMATCH", expected_path)
    for item, (_expected_path, expected_sha) in zip(reviewed, EXPECTED_REVIEWED_FILES):
        if item.get("sha256") != expected_sha:
            raise Phase1FA22ValidationError("REVIEWED_FILE_EVIDENCE_SHA_INVALID", item.get("path"))

    findings = content.get("security_review_findings")
    if not isinstance(findings, dict):
        raise Phase1FA22ValidationError("SECURITY_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1FA22ValidationError("SECURITY_FINDING_NOT_TRUE", field)
    for field in (
        "a20_exact_owner_approval_verified",
        "changed_files_match_a20_allowlist",
        "phase_1e_hash_pinned_host_wiring_files_preserved",
        "versioned_host_wiring_module_added",
        "versioned_host_wiring_tests_added",
        "pure_contract_layer_only",
        "disabled_by_default_present",
        "implementation_scope_guard_present",
        "host_wiring_manifest_secret_free",
        "gateway_wiring_denied",
        "profile_worker_wiring_denied",
        "no_auth_json_or_keychain_reads",
        "no_credential_materialization",
        "no_gateway_web_server_profile_worker_or_hermes_core_changes",
        "no_network_clients",
        "no_provider_or_model_api_calls",
        "no_runtime_binding",
        "no_runtime_execution",
        "no_runtime_process_start",
        "no_sandbox_launch",
        "no_subprocess_launch",
    ):
        if findings.get(field) is not True:
            raise Phase1FA22ValidationError("SECURITY_FINDING_REQUIRED_TRUE_MISSING", field)

    tests = content.get("test_results", {})
    if tests.get("phase_1f_a20_validator", {}).get("result") != "PASS":
        raise Phase1FA22ValidationError("SOURCE_VALIDATOR_RESULT_INVALID")
    if tests.get("targeted_versioned_host_runtime_wiring_contract_tests", {}).get("result") != "PASS" or tests.get("targeted_versioned_host_runtime_wiring_contract_tests", {}).get("tests") != 8:
        raise Phase1FA22ValidationError("TARGETED_CONTRACT_TESTS_INVALID")
    if tests.get("targeted_1f_a22_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_1f_a22_validator_tests", {}).get("tests") != 5:
        raise Phase1FA22ValidationError("TARGETED_A22_TESTS_INVALID")
    if tests.get("full_tools_unittest_discover", {}).get("result") != "PASS" or tests.get("full_tools_unittest_discover", {}).get("tests") != 881:
        raise Phase1FA22ValidationError("FULL_TESTS_INVALID")
    if content.get("required_changes") != []:
        raise Phase1FA22ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    if content.get("next_gate") != "PHASE_1F_A23_VERSIONED_GATEWAY_BINDING_APPROVAL_REQUEST":
        raise Phase1FA22ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "implementation_performed": True,
        "runtime_execution_approved": False,
        "gateway_binding_approved": False,
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
    except (Phase1FA22ValidationError, json.JSONDecodeError) as error:
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
