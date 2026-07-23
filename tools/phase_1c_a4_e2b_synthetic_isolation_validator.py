#!/usr/bin/env python3
"""Validate the Phase 1C-A4 E2B synthetic isolation proof approval packet.

This validator is read-only. It does not call E2B, create sandboxes, read
credentials, inspect environment values, install dependencies, or execute
Hermes profiles.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A4_E2B_SYNTHETIC_ISOLATION_PROOF_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1c-a4.e2b-synthetic-isolation-proof-contract.v1"
EXPECTED_CONTRACT_SHA = "0764a641d0e2b9dfea863eb3ce28703706ba5688d38328b7c06e6fcb85574314"
EXPECTED_APPROVAL_ID = "p1c-20260722-e2bproofa4"
EXPECTED_APPROVAL_COMMAND = (
    "APPROVE_PHASE_1C_E2B_SYNTHETIC_ISOLATION_PROOF:"
    f"{EXPECTED_APPROVAL_ID}:{EXPECTED_CONTRACT_SHA}"
)
EXPECTED_APPROVAL_COMMAND_SHA = "8588f01605d122707be0a39f58640d5fa35e2302148dedbf9bc42d824e2494b9"
EXPECTED_A3_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A3_ISOLATION_PROOF_CONTRACT.ready.json"
EXPECTED_A3_CONTRACT_FILE_SHA = "c94508c6d18eea0da01726f8cf277e655d9190cdf7da0bd8dc608a93416e315c"
EXPECTED_SYNTHETIC_KEYS = [
    "PANKSTER_PROFILE_ID",
    "PANKSTER_SYNTHETIC_MODEL_TOKEN",
    "PANKSTER_NETWORK_POLICY",
]
REQUIRED_FORBIDDEN_PATTERNS = {
    "*_KEY",
    "*_TOKEN",
    "*_SECRET",
    "*_PASSWORD",
    "ANTHROPIC_*",
    "OPENAI_*",
    "GLM_*",
    "GITEA_*",
    "SUPABASE_*",
    "TELEGRAM_*",
}
REQUIRED_PROOF_KEYS = {
    "sandbox_created_with_deny_all_before_user_code",
    "application_level_outbound_denial_observed",
    "sandbox_environment_contains_only_allowlisted_synthetic_keys",
    "sandbox_cannot_read_root_auth_json",
    "terminal_child_environment_sanitized",
    "code_execution_child_environment_sanitized",
    "mcp_child_environment_sanitized_or_not_available_fail_closed",
    "delegation_child_environment_sanitized_or_not_available_fail_closed",
    "policy_absent_fails_closed_before_sandbox_creation",
    "policy_invalid_fails_closed_before_sandbox_creation",
    "logs_evidence_secret_free",
    "sandbox_destroyed_after_probe",
}


class Phase1CA4ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1CA4ValidationError("CONTRACT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA4ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA4ValidationError("CONTRACT_NOT_OBJECT")
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA4ValidationError("SOURCE_A3_CONTRACT_MISSING", str(path)) from error


def _require_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA4ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path)
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA4ValidationError("SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise Phase1CA4ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise Phase1CA4ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise Phase1CA4ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise Phase1CA4ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise Phase1CA4ValidationError("CONTRACT_EXPIRED")

    if content.get("approval_id") != EXPECTED_APPROVAL_ID:
        raise Phase1CA4ValidationError("APPROVAL_ID_INVALID")
    if content.get("backend") != "e2b_sandbox":
        raise Phase1CA4ValidationError("BACKEND_INVALID")
    if content.get("synthetic_only") is not True:
        raise Phase1CA4ValidationError("SYNTHETIC_ONLY_MISSING")
    if content.get("provider_api_calls_allowed_before_approval") is not False:
        raise Phase1CA4ValidationError("PROVIDER_CALLS_ALLOWED_BEFORE_APPROVAL")
    if content.get("provider_api_calls_allowed_after_approval") is not True:
        raise Phase1CA4ValidationError("PROVIDER_CALLS_NOT_ALLOWED_AFTER_APPROVAL")
    if content.get("sandbox_creation_allowed_after_approval") is not True:
        raise Phase1CA4ValidationError("SANDBOX_CREATION_NOT_ALLOWED_AFTER_APPROVAL")
    if content.get("sandbox_destroy_required") is not True:
        raise Phase1CA4ValidationError("SANDBOX_DESTROY_NOT_REQUIRED")
    if content.get("sanitized_result_only") is not True:
        raise Phase1CA4ValidationError("SANITIZED_RESULT_ONLY_MISSING")

    for field in (
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "host_firewall_changes_allowed",
        "auth_files_read_allowed",
        "keychain_read_allowed",
        "environment_value_dump_allowed",
        "dependency_install_allowed",
    ):
        _require_false(content, field)

    if content.get("network_policy_required_before_user_code") is not True:
        raise Phase1CA4ValidationError("NETWORK_POLICY_NOT_REQUIRED_BEFORE_USER_CODE")
    if content.get("network_policy") != "deny_all_outbound":
        raise Phase1CA4ValidationError("NETWORK_POLICY_INVALID")
    if content.get("allowed_synthetic_environment_keys") != EXPECTED_SYNTHETIC_KEYS:
        raise Phase1CA4ValidationError("SYNTHETIC_ENV_ALLOWLIST_INVALID")
    if set(content.get("forbidden_environment_key_patterns", [])) != REQUIRED_FORBIDDEN_PATTERNS:
        raise Phase1CA4ValidationError("FORBIDDEN_ENV_PATTERNS_INVALID")

    synthetic_values = content.get("synthetic_values")
    if not isinstance(synthetic_values, dict):
        raise Phase1CA4ValidationError("SYNTHETIC_VALUES_INVALID")
    if synthetic_values != {
        "profile_id": "synthetic-e2b-proof",
        "model_token": "fake-profile-model-token",
        "network_policy": "deny_all",
    }:
        raise Phase1CA4ValidationError("SYNTHETIC_VALUES_NOT_MINIMAL_FAKE")

    required_proofs = content.get("required_proofs")
    if not isinstance(required_proofs, dict):
        raise Phase1CA4ValidationError("REQUIRED_PROOFS_INVALID")
    if set(required_proofs) != REQUIRED_PROOF_KEYS:
        raise Phase1CA4ValidationError("REQUIRED_PROOF_SET_INVALID")
    for field, value in required_proofs.items():
        if value is not True:
            raise Phase1CA4ValidationError(f"{field.upper()}_NOT_REQUIRED")

    source_evidence = content.get("source_evidence")
    if not isinstance(source_evidence, dict):
        raise Phase1CA4ValidationError("SOURCE_EVIDENCE_INVALID")
    if source_evidence.get("a3_contract_path") != "docs/program/PHASE_1C_A3_ISOLATION_PROOF_CONTRACT.ready.json":
        raise Phase1CA4ValidationError("SOURCE_A3_CONTRACT_PATH_INVALID")
    if source_evidence.get("a3_contract_file_sha256") != EXPECTED_A3_CONTRACT_FILE_SHA:
        raise Phase1CA4ValidationError("SOURCE_A3_CONTRACT_SHA_INVALID")
    if _sha256_file(EXPECTED_A3_CONTRACT) != EXPECTED_A3_CONTRACT_FILE_SHA:
        raise Phase1CA4ValidationError("SOURCE_A3_CONTRACT_SHA_MISMATCH")
    if hashlib.sha256(EXPECTED_APPROVAL_COMMAND.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA4ValidationError("APPROVAL_COMMAND_SHA_MISMATCH")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "backend": "e2b_sandbox",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_approval_command": EXPECTED_APPROVAL_COMMAND,
        "owner_approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "execution_approved": False,
        "provider_api_calls_allowed_before_approval": False,
        "sandbox_creation_allowed_without_approval": False,
        "next_gate": "PHASE_1C_A4_OWNER_APPROVAL_REQUIRED",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-contract"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-contract":
            _json_print(validate_contract(args.contract))
            return 0
    except (Phase1CA4ValidationError, json.JSONDecodeError) as error:
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
