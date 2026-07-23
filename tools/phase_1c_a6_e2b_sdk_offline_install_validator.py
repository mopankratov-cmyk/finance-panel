#!/usr/bin/env python3
"""Validate the Phase 1C-A6 E2B SDK offline install approval packet.

This validator is read-only. It does not create virtualenvs, install packages,
import E2B, read credentials, create sandboxes, or call provider APIs.
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A6_E2B_SDK_OFFLINE_INSTALL_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1c-a6.e2b-sdk-offline-install-contract.v1"
EXPECTED_CONTRACT_SHA = "e1f79f661e639380d66a7148d973ee6983cf21f3b9c7d467c4fe9592ca724000"
EXPECTED_APPROVAL_ID = "p1c-20260722-e2bsdkinstalla6"
EXPECTED_APPROVAL_COMMAND = (
    "APPROVE_PHASE_1C_E2B_SDK_OFFLINE_INSTALL:"
    f"{EXPECTED_APPROVAL_ID}:{EXPECTED_CONTRACT_SHA}"
)
EXPECTED_APPROVAL_COMMAND_SHA = "130ec9330cc0600b237f498789ed778dd75f51e64f479d35855fbffc967870ac"
EXPECTED_WHEELHOUSE = "/Users/maksimpankratov/.local/pankster/e2b-sdk-wheelhouse/2.34.0"
EXPECTED_VENV = "/Users/maksimpankratov/.local/pankster/e2b-sdk-venvs/2.34.0"
EXPECTED_A5_MANIFEST = PROJECT_ROOT / "security/evidence/phase-1c-a5/e2b-sdk-wheelhouse-manifest.json"
EXPECTED_A5_MANIFEST_SHA = "bc505cb6c572a8455a3a4b7260aee6c422a8d31eec714e8a67d5fc0da7e63077"


class Phase1CA6ValidationError(RuntimeError):
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
        raise Phase1CA6ValidationError("CONTRACT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA6ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA6ValidationError("CONTRACT_NOT_OBJECT")
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA6ValidationError("SOURCE_A5_MANIFEST_MISSING", str(path)) from error


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path)
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA6ValidationError("SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise Phase1CA6ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise Phase1CA6ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise Phase1CA6ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise Phase1CA6ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise Phase1CA6ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != EXPECTED_APPROVAL_ID:
        raise Phase1CA6ValidationError("APPROVAL_ID_INVALID")
    if content.get("package") != "e2b==2.34.0":
        raise Phase1CA6ValidationError("PACKAGE_PIN_INVALID")

    install_scope = content.get("install_scope")
    if not isinstance(install_scope, dict):
        raise Phase1CA6ValidationError("INSTALL_SCOPE_INVALID")
    if install_scope.get("mode") != "offline-wheelhouse-only":
        raise Phase1CA6ValidationError("INSTALL_MODE_INVALID")
    if install_scope.get("wheelhouse_path") != EXPECTED_WHEELHOUSE:
        raise Phase1CA6ValidationError("WHEELHOUSE_PATH_INVALID")
    if install_scope.get("venv_path") != EXPECTED_VENV:
        raise Phase1CA6ValidationError("VENV_PATH_INVALID")
    if install_scope.get("allowed_command_prefix") != ["python3", "-m", "venv"]:
        raise Phase1CA6ValidationError("VENV_COMMAND_PREFIX_INVALID")
    if install_scope.get("pip_install_args_required") != [
        "--no-index",
        "--find-links",
        EXPECTED_WHEELHOUSE,
        "e2b==2.34.0",
    ]:
        raise Phase1CA6ValidationError("PIP_INSTALL_ARGS_INVALID")
    for field in (
        "network_allowed",
        "pypi_allowed",
        "global_site_packages_allowed",
        "system_python_mutation_allowed",
        "package_manager_state_mutation_allowed",
    ):
        if install_scope.get(field) is not False:
            raise Phase1CA6ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if install_scope.get("dependency_import_allowed_for_offline_verification") is not True:
        raise Phase1CA6ValidationError("OFFLINE_IMPORT_VERIFICATION_NOT_ALLOWED")

    forbidden = content.get("forbidden_actions")
    if not isinstance(forbidden, dict):
        raise Phase1CA6ValidationError("FORBIDDEN_ACTIONS_INVALID")
    for field, value in forbidden.items():
        if value is not True:
            raise Phase1CA6ValidationError(f"{field.upper()}_NOT_FORBIDDEN")

    required = content.get("required_outputs")
    if not isinstance(required, dict):
        raise Phase1CA6ValidationError("REQUIRED_OUTPUTS_INVALID")
    for must_be_true in (
        "venv_created_under_allowed_path",
        "pip_install_used_no_index",
        "pip_install_used_locked_wheelhouse",
        "installed_e2b_version_verified",
        "offline_import_verification_passed",
        "sanitized_evidence_only",
        "rollback_plan_recorded",
    ):
        if required.get(must_be_true) is not True:
            raise Phase1CA6ValidationError(f"{must_be_true.upper()}_NOT_REQUIRED")
    for must_be_false in (
        "provider_credential_presence_checked",
        "provider_credential_value_printed",
        "provider_api_calls_performed",
        "sandbox_created",
    ):
        if required.get(must_be_false) is not False:
            raise Phase1CA6ValidationError(f"{must_be_false.upper()}_UNEXPECTEDLY_REQUIRED")

    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA6ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a5_wheelhouse_manifest_sha256") != EXPECTED_A5_MANIFEST_SHA:
        raise Phase1CA6ValidationError("SOURCE_A5_MANIFEST_SHA_INVALID")
    if _sha256_file(EXPECTED_A5_MANIFEST) != EXPECTED_A5_MANIFEST_SHA:
        raise Phase1CA6ValidationError("SOURCE_A5_MANIFEST_SHA_MISMATCH")
    if hashlib.sha256(EXPECTED_APPROVAL_COMMAND.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA6ValidationError("APPROVAL_COMMAND_SHA_MISMATCH")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_approval_command": EXPECTED_APPROVAL_COMMAND,
        "owner_approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "dependency_install_approved": False,
        "offline_import_verification_allowed_after_approval": True,
        "provider_api_calls_allowed": False,
        "sandbox_creation_allowed": False,
        "pypi_allowed": False,
        "next_gate": "PHASE_1C_A6_OWNER_APPROVAL_REQUIRED",
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
    except (Phase1CA6ValidationError, json.JSONDecodeError) as error:
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
