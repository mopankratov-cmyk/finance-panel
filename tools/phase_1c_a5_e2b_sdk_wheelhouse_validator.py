#!/usr/bin/env python3
"""Validate the Phase 1C-A5 E2B SDK wheelhouse lock approval packet.

This validator is read-only. It does not download packages, install packages,
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A5_E2B_SDK_WHEELHOUSE_LOCK_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1c-a5.e2b-sdk-wheelhouse-lock-contract.v1"
EXPECTED_CONTRACT_SHA = "46c9ab5e52e015ddda80c7bfdcdac316cc1ca80140846b38e728a221e2972382"
EXPECTED_APPROVAL_ID = "p1c-20260722-e2bsdklocka5"
EXPECTED_APPROVAL_COMMAND = (
    "APPROVE_PHASE_1C_E2B_SDK_WHEELHOUSE_LOCK:"
    f"{EXPECTED_APPROVAL_ID}:{EXPECTED_CONTRACT_SHA}"
)
EXPECTED_APPROVAL_COMMAND_SHA = "898e885f11486daf94ead0382967d2f3515c507c2e750e061a815664ba153827"
EXPECTED_PRIMARY_WHEEL_SHA = "873323571d18bf633be45e59fc6271410b30dfbc81e8df85e711f4f184c03fea"
EXPECTED_A4_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a4/e2b-synthetic-isolation-proof-execution-attempt.json"
EXPECTED_A4_EVIDENCE_SHA = "671ebb7c2e2e97b68b50641b952d773a5b64f7bbe0fa3305ae923538a4e410e7"


class Phase1CA5ValidationError(RuntimeError):
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
        raise Phase1CA5ValidationError("CONTRACT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA5ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA5ValidationError("CONTRACT_NOT_OBJECT")
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA5ValidationError("SOURCE_A4_EVIDENCE_MISSING", str(path)) from error


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path)
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA5ValidationError("SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise Phase1CA5ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise Phase1CA5ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise Phase1CA5ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise Phase1CA5ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise Phase1CA5ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != EXPECTED_APPROVAL_ID:
        raise Phase1CA5ValidationError("APPROVAL_ID_INVALID")
    if content.get("blocked_reason_from_a4") != "E2B_SDK_NOT_AVAILABLE":
        raise Phase1CA5ValidationError("A4_BLOCK_REASON_INVALID")
    if content.get("package_manager") != "pip-download-only":
        raise Phase1CA5ValidationError("PACKAGE_MANAGER_INVALID")

    package = content.get("python_package")
    if not isinstance(package, dict):
        raise Phase1CA5ValidationError("PYTHON_PACKAGE_INVALID")
    if package.get("name") != "e2b" or package.get("version") != "2.34.0":
        raise Phase1CA5ValidationError("PYTHON_PACKAGE_PIN_INVALID")
    if package.get("requires_python") != ">=3.10":
        raise Phase1CA5ValidationError("PYTHON_REQUIRES_INVALID")

    artifacts = content.get("primary_artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 1:
        raise Phase1CA5ValidationError("PRIMARY_ARTIFACTS_INVALID")
    wheel = artifacts[0]
    if wheel.get("filename") != "e2b-2.34.0-py3-none-any.whl":
        raise Phase1CA5ValidationError("PRIMARY_WHEEL_FILENAME_INVALID")
    if wheel.get("packagetype") != "bdist_wheel":
        raise Phase1CA5ValidationError("PRIMARY_WHEEL_TYPE_INVALID")
    if wheel.get("sha256") != EXPECTED_PRIMARY_WHEEL_SHA:
        raise Phase1CA5ValidationError("PRIMARY_WHEEL_SHA_INVALID")
    if wheel.get("yanked") is not False:
        raise Phase1CA5ValidationError("PRIMARY_WHEEL_YANKED")

    download_scope = content.get("download_scope")
    if not isinstance(download_scope, dict):
        raise Phase1CA5ValidationError("DOWNLOAD_SCOPE_INVALID")
    if download_scope.get("allowed_hosts") != ["pypi.org", "files.pythonhosted.org"]:
        raise Phase1CA5ValidationError("DOWNLOAD_HOSTS_INVALID")
    for field in (
        "allow_sdists",
        "allow_yanked",
        "dependency_install_allowed",
        "dependency_import_allowed",
    ):
        if download_scope.get(field) is not False:
            raise Phase1CA5ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    for field in ("require_hash_manifest", "require_only_binary"):
        if download_scope.get(field) is not True:
            raise Phase1CA5ValidationError(f"{field.upper()}_NOT_REQUIRED")

    forbidden = content.get("forbidden_actions")
    if not isinstance(forbidden, dict):
        raise Phase1CA5ValidationError("FORBIDDEN_ACTIONS_INVALID")
    for field, value in forbidden.items():
        if value is not True:
            raise Phase1CA5ValidationError(f"{field.upper()}_NOT_FORBIDDEN")

    outputs = content.get("required_outputs")
    if not isinstance(outputs, dict):
        raise Phase1CA5ValidationError("REQUIRED_OUTPUTS_INVALID")
    for field, value in outputs.items():
        if value is not True:
            raise Phase1CA5ValidationError(f"{field.upper()}_NOT_REQUIRED")

    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA5ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a4_execution_attempt_sha256") != EXPECTED_A4_EVIDENCE_SHA:
        raise Phase1CA5ValidationError("SOURCE_A4_EVIDENCE_SHA_INVALID")
    if _sha256_file(EXPECTED_A4_EVIDENCE) != EXPECTED_A4_EVIDENCE_SHA:
        raise Phase1CA5ValidationError("SOURCE_A4_EVIDENCE_SHA_MISMATCH")
    if hashlib.sha256(EXPECTED_APPROVAL_COMMAND.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA5ValidationError("APPROVAL_COMMAND_SHA_MISMATCH")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_approval_command": EXPECTED_APPROVAL_COMMAND,
        "owner_approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "dependency_download_approved": False,
        "dependency_install_allowed": False,
        "dependency_import_allowed": False,
        "provider_api_calls_allowed": False,
        "sandbox_creation_allowed": False,
        "next_gate": "PHASE_1C_A5_OWNER_APPROVAL_REQUIRED",
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
    except (Phase1CA5ValidationError, json.JSONDecodeError) as error:
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
