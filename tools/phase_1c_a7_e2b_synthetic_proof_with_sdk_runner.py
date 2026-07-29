#!/usr/bin/env python3
"""Phase 1C-A7 approved synthetic E2B proof runner.

This wrapper runs the A4 synthetic proof with the A6 isolated SDK venv after
exact A7 owner approval. It allowlists the runner process environment and
passes only `E2B_API_KEY` as the E2B control-plane credential. The credential
value is never printed or written to evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.phase_1c_a7_e2b_synthetic_proof_with_sdk_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_ENV_ALLOWLIST,
    EXPECTED_VENV_PYTHON,
    validate_contract,
)


A4_APPROVAL_COMMAND = (
    "APPROVE_PHASE_1C_E2B_SYNTHETIC_ISOLATION_PROOF:"
    "p1c-20260722-e2bproofa4:"
    "0764a641d0e2b9dfea863eb3ce28703706ba5688d38328b7c06e6fcb85574314"
)
A4_RUNNER = PROJECT_ROOT / "tools/phase_1c_a4_e2b_synthetic_proof_runner.py"
DEFAULT_MANIFEST_OUTPUT = PROJECT_ROOT / "security/evidence/phase-1c-a7/e2b-synthetic-proof-with-sdk-execution.json"
MAX_CAPTURED_OUTPUT_CHARS = 6000
SENSITIVE_LINE_RE = re.compile(
    r"(^|\b)([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*|"
    r"ANTHROPIC_[A-Z0-9_]*|OPENAI_[A-Z0-9_]*|GLM_[A-Z0-9_]*|"
    r"GITEA_[A-Z0-9_]*|SUPABASE_[A-Z0-9_]*|TELEGRAM_[A-Z0-9_]*)\s*=",
    re.IGNORECASE,
)
BEARER_LINE_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._-]{8,}", re.IGNORECASE)
E2B_SECRET_RE = re.compile(r"(?<![A-Za-z0-9_])e2b_[A-Za-z0-9]{8,}")


class Phase1CA7ExecutionError(RuntimeError):
    def __init__(self, reason: str, detail: object | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _safe_text(value: str) -> str:
    text = value.replace("\x00", "").strip()
    redacted_lines = []
    for line in text.splitlines():
        if SENSITIVE_LINE_RE.search(line) or BEARER_LINE_RE.search(line) or E2B_SECRET_RE.search(line):
            redacted_lines.append("[REDACTED_SENSITIVE_LINE]")
        else:
            redacted_lines.append(line)
    return "\n".join(redacted_lines)[:MAX_CAPTURED_OUTPUT_CHARS]


def validate_owner_approval(approval_command: str) -> None:
    if approval_command != EXPECTED_APPROVAL_COMMAND:
        raise Phase1CA7ExecutionError("OWNER_APPROVAL_COMMAND_MISMATCH")
    if hashlib.sha256(approval_command.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA7ExecutionError("OWNER_APPROVAL_COMMAND_SHA_MISMATCH")


def _runner_env() -> dict[str, str]:
    env = {key: os.environ[key] for key in EXPECTED_ENV_ALLOWLIST if key in os.environ}
    return env


def _credential_name_present() -> bool:
    # Presence-only check. Value is never returned or printed.
    return "E2B_API_KEY" in os.environ


def _venv_e2b_version() -> str:
    result = subprocess.run(
        [
            EXPECTED_VENV_PYTHON,
            "-c",
            "import importlib.metadata as m; print(m.version('e2b'))",
        ],
        check=False,
        env=_runner_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise Phase1CA7ExecutionError(
            "A6_VENV_E2B_VERSION_CHECK_FAILED",
            {"returncode": result.returncode, "stderr": _safe_text(result.stderr)},
        )
    return result.stdout.strip()


def build_a4_command() -> list[str]:
    return [
        EXPECTED_VENV_PYTHON,
        str(A4_RUNNER),
        "--mode",
        "execute-synthetic-proof",
        "--approval-command",
        A4_APPROVAL_COMMAND,
    ]


def preflight(contract_path: Path, approval_command: str) -> dict:
    validate_contract(contract_path)
    validate_owner_approval(approval_command)
    version = _venv_e2b_version()
    if version != "2.34.0":
        raise Phase1CA7ExecutionError("A6_VENV_E2B_VERSION_MISMATCH", version)
    env_keys = sorted(_runner_env())
    forbidden = sorted(key for key in env_keys if key not in EXPECTED_ENV_ALLOWLIST)
    if forbidden:
        raise Phase1CA7ExecutionError("RUNNER_ENV_FORBIDDEN_KEYS_PRESENT", forbidden)
    return {
        "result": "PASS",
        "mode": "preflight-approved",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "venv_python": EXPECTED_VENV_PYTHON,
        "e2b_version": version,
        "runner_env_allowlisted": True,
        "runner_env_keys": env_keys,
        "e2b_api_key_name_present": _credential_name_present(),
        "provider_credential_value_printed": False,
        "provider_api_calls_approved": True,
        "sandbox_creation_approved": True,
        "sandbox_created": False,
        "a4_command": build_a4_command(),
    }


def execute_proof(
    contract_path: Path,
    approval_command: str,
    *,
    manifest_output: Path | None = DEFAULT_MANIFEST_OUTPUT,
) -> dict:
    preflight_payload = preflight(contract_path, approval_command)
    if not _credential_name_present():
        manifest = {
            "schema_version": "pankster.phase1c-a7.e2b-synthetic-proof-with-sdk-execution.v1",
            "result": "FAIL_CLOSED",
            "mode": "execute-proof",
            "reason": "E2B_API_KEY_NOT_CONFIGURED",
            "failure_policy": "FAIL_CLOSED_BEFORE_SANDBOX_CREATION",
            "contract_content_sha256": EXPECTED_CONTRACT_SHA,
            "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
            "preflight": preflight_payload,
            "provider_credential_presence_checked": True,
            "provider_credential_value_printed": False,
            "provider_api_calls_performed": False,
            "sandbox_created": False,
            "sandbox_destroyed": False,
            "sanitized": True,
        }
    else:
        result = subprocess.run(
            build_a4_command(),
            check=False,
            env=_runner_env(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=240,
        )
        stdout = _safe_text(result.stdout)
        stderr = _safe_text(result.stderr)
        proof_payload = None
        if stdout:
            try:
                proof_payload = json.loads(stdout)
            except json.JSONDecodeError:
                proof_payload = None
        manifest = {
            "schema_version": "pankster.phase1c-a7.e2b-synthetic-proof-with-sdk-execution.v1",
            "result": "PASS" if result.returncode == 0 else "DENIED",
            "mode": "execute-proof",
            "contract_content_sha256": EXPECTED_CONTRACT_SHA,
            "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
            "preflight": preflight_payload,
            "a4_runner_returncode": result.returncode,
            "a4_runner_stdout_sanitized": stdout,
            "a4_runner_stderr_sanitized": stderr,
            "a4_runner_json": proof_payload,
            "provider_credential_presence_checked": True,
            "provider_credential_value_printed": False,
            "provider_api_calls_performed": True,
            "sandbox_created": bool(proof_payload and proof_payload.get("sandbox_created") is True),
            "sandbox_destroyed": bool(proof_payload and proof_payload.get("sandbox_destroyed") is True),
            "sanitized": True,
        }
    if manifest_output is not None:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight-approved", "execute-proof"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-command", required=True)
    parser.add_argument("--manifest-output", type=Path, default=DEFAULT_MANIFEST_OUTPUT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight-approved":
            _json_print(preflight(args.contract, args.approval_command))
            return 0
        if args.mode == "execute-proof":
            manifest = execute_proof(args.contract, args.approval_command, manifest_output=args.manifest_output)
            _json_print(manifest)
            return 0 if manifest["result"] == "PASS" else 1
    except Phase1CA7ExecutionError as error:
        payload = {
            "result": "DENIED",
            "mode": args.mode,
            "reason": error.reason,
            "provider_credential_value_printed": False,
            "provider_api_calls_performed": False,
            "sandbox_created": False,
        }
        if error.detail is not None:
            payload["detail"] = error.detail
        _json_print(payload)
        return 1
    raise AssertionError(f"unhandled mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
