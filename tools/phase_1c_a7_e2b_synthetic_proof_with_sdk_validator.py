#!/usr/bin/env python3
"""Validate the Phase 1C-A7 E2B synthetic proof-with-SDK approval packet.

This validator is read-only. It does not read provider credentials, call E2B,
create sandboxes, run profiles, or start canaries.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A7_E2B_SYNTHETIC_PROOF_WITH_SDK_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1c-a7.e2b-synthetic-proof-with-sdk-contract.v1"
EXPECTED_CONTRACT_SHA = "2537f7550e839bfdfc60ffa158de755185cb1e545e7311cb828439a207791d79"
EXPECTED_APPROVAL_ID = "p1c-20260722-e2bproofa7"
EXPECTED_APPROVAL_COMMAND = (
    "APPROVE_PHASE_1C_E2B_SYNTHETIC_PROOF_WITH_SDK:"
    f"{EXPECTED_APPROVAL_ID}:{EXPECTED_CONTRACT_SHA}"
)
EXPECTED_APPROVAL_COMMAND_SHA = "abc50729f3ed6c6c302d2ef2d78882474d2d3ca74d09ae9a0cf246a74a386f22"
EXPECTED_VENV_PYTHON = "/Users/maksimpankratov/.local/pankster/e2b-sdk-venvs/2.34.0/bin/python"
EXPECTED_A6_MANIFEST = PROJECT_ROOT / "security/evidence/phase-1c-a6/e2b-sdk-offline-install-manifest.json"
EXPECTED_A6_MANIFEST_SHA = "0737dcec1e4743d9f9af95b04007a5865d5cdb8781be313a9a6252057289f53b"
EXPECTED_A4_RUNNER = PROJECT_ROOT / "tools/phase_1c_a4_e2b_synthetic_proof_runner.py"
EXPECTED_A4_RUNNER_SHA = "4663fdfae07f700a13e58e686a380ad7ca5c1fceb75416c472c1bc5cfb20a221"
EXPECTED_ENV_ALLOWLIST = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SHELL",
    "NO_PROXY",
    "no_proxy",
    "E2B_API_KEY",
]


class Phase1CA7ValidationError(RuntimeError):
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
        raise Phase1CA7ValidationError("CONTRACT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA7ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA7ValidationError("CONTRACT_NOT_OBJECT")
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA7ValidationError("SOURCE_FILE_MISSING", str(path)) from error


def _venv_e2b_version() -> str:
    result = subprocess.run(
        [
            EXPECTED_VENV_PYTHON,
            "-c",
            "import importlib.metadata as m; print(m.version('e2b'))",
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise Phase1CA7ValidationError("VENV_E2B_VERSION_CHECK_FAILED")
    return result.stdout.strip()


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path)
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA7ValidationError("SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise Phase1CA7ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise Phase1CA7ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise Phase1CA7ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise Phase1CA7ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise Phase1CA7ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != EXPECTED_APPROVAL_ID:
        raise Phase1CA7ValidationError("APPROVAL_ID_INVALID")

    sdk = content.get("sdk")
    if not isinstance(sdk, dict):
        raise Phase1CA7ValidationError("SDK_BLOCK_INVALID")
    if sdk.get("venv_python") != EXPECTED_VENV_PYTHON:
        raise Phase1CA7ValidationError("SDK_VENV_PYTHON_INVALID")
    if sdk.get("package") != "e2b" or sdk.get("version") != "2.34.0":
        raise Phase1CA7ValidationError("SDK_VERSION_PIN_INVALID")
    if _venv_e2b_version() != "2.34.0":
        raise Phase1CA7ValidationError("SDK_INSTALLED_VERSION_MISMATCH")

    execution = content.get("execution")
    if not isinstance(execution, dict):
        raise Phase1CA7ValidationError("EXECUTION_BLOCK_INVALID")
    if execution.get("runner_path") != "tools/phase_1c_a4_e2b_synthetic_proof_runner.py":
        raise Phase1CA7ValidationError("RUNNER_PATH_INVALID")
    if execution.get("runner_mode") != "execute-synthetic-proof":
        raise Phase1CA7ValidationError("RUNNER_MODE_INVALID")
    if execution.get("runner_process_environment_allowlist") != EXPECTED_ENV_ALLOWLIST:
        raise Phase1CA7ValidationError("RUNNER_ENV_ALLOWLIST_INVALID")
    sandbox_policy = execution.get("sandbox_create_policy")
    if not isinstance(sandbox_policy, dict):
        raise Phase1CA7ValidationError("SANDBOX_POLICY_INVALID")
    if sandbox_policy.get("allow_internet_access") is not False:
        raise Phase1CA7ValidationError("SANDBOX_INTERNET_NOT_DISABLED")
    if sandbox_policy.get("timeout_seconds") != 120:
        raise Phase1CA7ValidationError("SANDBOX_TIMEOUT_INVALID")
    if set(sandbox_policy.get("envs", {})) != {
        "PANKSTER_PROFILE_ID",
        "PANKSTER_SYNTHETIC_MODEL_TOKEN",
        "PANKSTER_NETWORK_POLICY",
    }:
        raise Phase1CA7ValidationError("SANDBOX_SYNTHETIC_ENV_INVALID")

    credential = content.get("e2b_control_plane_credential")
    if not isinstance(credential, dict):
        raise Phase1CA7ValidationError("E2B_CREDENTIAL_BLOCK_INVALID")
    if credential.get("env_name") != "E2B_API_KEY":
        raise Phase1CA7ValidationError("E2B_CREDENTIAL_ENV_INVALID")
    if credential.get("allowed_after_approval") is not True:
        raise Phase1CA7ValidationError("E2B_CREDENTIAL_NOT_ALLOWED_AFTER_APPROVAL")
    for field in ("value_printed", "passed_to_sandbox", "used_for_model_auth"):
        if credential.get(field) is not False:
            raise Phase1CA7ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")

    for block_name in ("forbidden_credentials", "forbidden_actions"):
        block = content.get(block_name)
        if not isinstance(block, dict):
            raise Phase1CA7ValidationError(f"{block_name.upper()}_INVALID")
        for field, value in block.items():
            if value is not True:
                raise Phase1CA7ValidationError(f"{field.upper()}_NOT_FORBIDDEN")

    proofs = content.get("required_proofs")
    if not isinstance(proofs, dict):
        raise Phase1CA7ValidationError("REQUIRED_PROOFS_INVALID")
    for field, value in proofs.items():
        if value is not True:
            raise Phase1CA7ValidationError(f"{field.upper()}_NOT_REQUIRED")

    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA7ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a6_install_manifest_sha256") != EXPECTED_A6_MANIFEST_SHA:
        raise Phase1CA7ValidationError("SOURCE_A6_MANIFEST_SHA_INVALID")
    if _sha256_file(EXPECTED_A6_MANIFEST) != EXPECTED_A6_MANIFEST_SHA:
        raise Phase1CA7ValidationError("SOURCE_A6_MANIFEST_SHA_MISMATCH")
    if source.get("a4_runner_sha256") != EXPECTED_A4_RUNNER_SHA:
        raise Phase1CA7ValidationError("SOURCE_A4_RUNNER_SHA_INVALID")
    if _sha256_file(EXPECTED_A4_RUNNER) != EXPECTED_A4_RUNNER_SHA:
        raise Phase1CA7ValidationError("SOURCE_A4_RUNNER_SHA_MISMATCH")
    if hashlib.sha256(EXPECTED_APPROVAL_COMMAND.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA7ValidationError("APPROVAL_COMMAND_SHA_MISMATCH")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_approval_command": EXPECTED_APPROVAL_COMMAND,
        "owner_approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "provider_api_calls_approved": False,
        "sandbox_creation_approved": False,
        "e2b_control_plane_credential_allowed_after_approval": True,
        "provider_credential_value_printed": False,
        "next_gate": "PHASE_1C_A7_OWNER_APPROVAL_REQUIRED",
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
    except (Phase1CA7ValidationError, json.JSONDecodeError) as error:
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
