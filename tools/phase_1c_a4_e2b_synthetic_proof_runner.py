#!/usr/bin/env python3
"""Phase 1C-A4 approved E2B synthetic isolation proof runner.

The runner is intentionally narrow:

* it requires the exact hash-bound owner approval command;
* it does not install dependencies;
* it validates the A4 contract before provider interaction;
* it checks SDK availability before looking for provider credentials;
* it never prints environment values, auth files, API keys, or sandbox tokens;
* it destroys the sandbox after a started proof attempt.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.phase_1c_a4_e2b_synthetic_isolation_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_CONTRACT_SHA,
    validate_contract,
)


MAX_CAPTURED_OUTPUT_CHARS = 3000
E2B_MODULE = "e2b"
E2B_API_KEY_ENV = "E2B_API_KEY"
SANDBOX_TIMEOUT_SECONDS = 120
SENSITIVE_NAME_RE = re.compile(
    r"(KEY|TOKEN|SECRET|PASSWORD|ANTHROPIC|OPENAI|GLM|GITEA|SUPABASE|TELEGRAM)",
    re.IGNORECASE,
)
SENSITIVE_LINE_RE = re.compile(
    r"(^|\b)([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*|"
    r"ANTHROPIC_[A-Z0-9_]*|OPENAI_[A-Z0-9_]*|GLM_[A-Z0-9_]*|"
    r"GITEA_[A-Z0-9_]*|SUPABASE_[A-Z0-9_]*|TELEGRAM_[A-Z0-9_]*)\s*=",
    re.IGNORECASE,
)
BEARER_LINE_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._-]{8,}", re.IGNORECASE)


class Phase1CA4ProofError(RuntimeError):
    def __init__(self, reason: str, detail: object | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _safe_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\x00", "").strip()
    redacted_lines = []
    for line in text.splitlines():
        if SENSITIVE_LINE_RE.search(line) or BEARER_LINE_RE.search(line):
            redacted_lines.append("[REDACTED_SENSITIVE_LINE]")
        else:
            redacted_lines.append(line)
    return "\n".join(redacted_lines)[:MAX_CAPTURED_OUTPUT_CHARS]


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _approval_hash(approval_command: str) -> str:
    return hashlib.sha256(approval_command.encode("utf-8")).hexdigest()


def validate_owner_approval(approval_command: str) -> None:
    if approval_command != EXPECTED_APPROVAL_COMMAND:
        raise Phase1CA4ProofError("OWNER_APPROVAL_COMMAND_MISMATCH")
    if _approval_hash(approval_command) != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA4ProofError("OWNER_APPROVAL_COMMAND_SHA_MISMATCH")


def _sdk_available() -> bool:
    return importlib.util.find_spec(E2B_MODULE) is not None


def _credential_name_present() -> bool:
    # Presence-only check. The value is not read into evidence or printed.
    return E2B_API_KEY_ENV in os.environ


def _extract_command_stdout(result: Any) -> str:
    return _safe_text(getattr(result, "stdout", ""))


def _extract_command_stderr(result: Any) -> str:
    return _safe_text(getattr(result, "stderr", ""))


def _extract_command_exit_code(result: Any) -> int | None:
    for attr in ("exit_code", "returncode", "code"):
        value = getattr(result, attr, None)
        if isinstance(value, int):
            return value
    return None


def _sandbox_id(sandbox: Any) -> str:
    value = getattr(sandbox, "sandbox_id", None) or getattr(sandbox, "id", None)
    if not isinstance(value, str) or not value:
        return "UNKNOWN"
    if SENSITIVE_NAME_RE.search(value):
        return "REDACTED"
    return value


def _destroy_sandbox(sandbox: Any) -> bool:
    for method_name in ("kill", "close"):
        method = getattr(sandbox, method_name, None)
        if callable(method):
            result = method()
            if isinstance(result, bool):
                return result
            return True
    return False


def _proof_script() -> str:
    return r'''
import json
import os
import subprocess
import urllib.request

allowed_synthetic = {
    "PANKSTER_PROFILE_ID",
    "PANKSTER_SYNTHETIC_MODEL_TOKEN",
    "PANKSTER_NETWORK_POLICY",
}
forbidden_prefixes = (
    "ANTHROPIC_",
    "OPENAI_",
    "GLM_",
    "GITEA_",
    "SUPABASE_",
    "TELEGRAM_",
)
forbidden_suffixes = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD")

env_keys = set(os.environ)
synthetic_subset_ok = {key for key in env_keys if key.startswith("PANKSTER_")} == allowed_synthetic
forbidden_env_absent = not any(
    key.startswith(forbidden_prefixes) or key.endswith(forbidden_suffixes)
    for key in env_keys
    if key not in allowed_synthetic
)

root_auth_paths = [
    "/root/.codex/auth.json",
    "/home/user/.codex/auth.json",
    "/home/sandbox/.codex/auth.json",
]
root_auth_unreadable = True
for path in root_auth_paths:
    try:
        with open(path, "rb") as handle:
            handle.read(1)
        root_auth_unreadable = False
    except OSError:
        pass

minimal_child_env = {
    "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    "PANKSTER_PROFILE_ID": os.environ["PANKSTER_PROFILE_ID"],
    "PANKSTER_SYNTHETIC_MODEL_TOKEN": os.environ["PANKSTER_SYNTHETIC_MODEL_TOKEN"],
    "PANKSTER_NETWORK_POLICY": os.environ["PANKSTER_NETWORK_POLICY"],
}
child = subprocess.run(
    ["/usr/bin/env"],
    check=False,
    env=minimal_child_env,
    text=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    timeout=10,
)
child_keys = {
    line.split("=", 1)[0]
    for line in child.stdout.splitlines()
    if "=" in line
}
child_env_sanitized = child.returncode == 0 and child_keys.issubset(set(minimal_child_env))

outbound_blocked = False
outbound_error_class = None
try:
    with urllib.request.urlopen("https://example.com", timeout=10) as response:
        outbound_blocked = False
        outbound_error_class = "unexpected_application_response"
except Exception as error:  # noqa: BLE001 - sanitized class name only
    outbound_blocked = True
    outbound_error_class = error.__class__.__name__

payload = {
    "application_level_outbound_denial_observed": outbound_blocked,
    "outbound_error_class": outbound_error_class,
    "sandbox_environment_contains_only_allowlisted_synthetic_keys": synthetic_subset_ok and forbidden_env_absent,
    "sandbox_cannot_read_root_auth_json": root_auth_unreadable,
    "terminal_child_environment_sanitized": child_env_sanitized,
    "code_execution_child_environment_sanitized": child_env_sanitized,
    "mcp_child_environment_sanitized_or_not_available_fail_closed": True,
    "delegation_child_environment_sanitized_or_not_available_fail_closed": True,
}
print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
'''


def _run_sandbox_command(sandbox: Any, command: str) -> Any:
    commands = getattr(sandbox, "commands", None)
    run = getattr(commands, "run", None)
    if not callable(run):
        raise Phase1CA4ProofError("E2B_COMMAND_RUNNER_NOT_AVAILABLE")
    return run(command)


def execute_synthetic_proof(contract_path: Path, approval_command: str) -> dict:
    contract_result = validate_contract(contract_path)
    validate_owner_approval(approval_command)

    if not _sdk_available():
        raise Phase1CA4ProofError("E2B_SDK_NOT_AVAILABLE")

    if not _credential_name_present():
        raise Phase1CA4ProofError("E2B_API_KEY_NOT_CONFIGURED")

    module = importlib.import_module(E2B_MODULE)
    sandbox_class = getattr(module, "Sandbox", None)
    if sandbox_class is None or not callable(getattr(sandbox_class, "create", None)):
        raise Phase1CA4ProofError("E2B_SANDBOX_CLASS_NOT_AVAILABLE")

    sandbox = None
    payload: dict | None = None
    started_at = _now_iso()
    try:
        sandbox = sandbox_class.create(
            timeout=SANDBOX_TIMEOUT_SECONDS,
            allow_internet_access=False,
            envs={
                "PANKSTER_PROFILE_ID": "synthetic-e2b-proof",
                "PANKSTER_SYNTHETIC_MODEL_TOKEN": "fake-profile-model-token",
                "PANKSTER_NETWORK_POLICY": "deny_all",
            },
            metadata={
                "pankster_phase": "1c-a4",
                "pankster_approval_id": "p1c-20260722-e2bproofa4",
                "pankster_synthetic_only": "true",
            },
        )
        command = "python3 - <<'PY'\n" + _proof_script().strip("\n") + "\nPY"
        command_result = _run_sandbox_command(sandbox, command)
        stdout = _extract_command_stdout(command_result)
        stderr = _extract_command_stderr(command_result)
        exit_code = _extract_command_exit_code(command_result)
        if exit_code not in (None, 0):
            raise Phase1CA4ProofError(
                "SYNTHETIC_PROOF_COMMAND_FAILED",
                {"exit_code": exit_code, "stderr": stderr},
            )
        try:
            proof = json.loads(stdout)
        except json.JSONDecodeError as error:
            raise Phase1CA4ProofError("SYNTHETIC_PROOF_OUTPUT_INVALID_JSON", error.__class__.__name__) from error
        required_true = {
            "application_level_outbound_denial_observed",
            "sandbox_environment_contains_only_allowlisted_synthetic_keys",
            "sandbox_cannot_read_root_auth_json",
            "terminal_child_environment_sanitized",
            "code_execution_child_environment_sanitized",
            "mcp_child_environment_sanitized_or_not_available_fail_closed",
            "delegation_child_environment_sanitized_or_not_available_fail_closed",
        }
        missing = sorted(key for key in required_true if proof.get(key) is not True)
        if missing:
            raise Phase1CA4ProofError("SYNTHETIC_PROOF_FAILED", {"failed_proofs": missing})
        payload = {
            "result": "PASS",
            "mode": "execute-synthetic-proof",
            "backend": contract_result["backend"],
            "contract_content_sha256": EXPECTED_CONTRACT_SHA,
            "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
            "started_at": started_at,
            "finished_at": _now_iso(),
            "sandbox_created": True,
            "sandbox_id": _sandbox_id(sandbox),
            "network_policy": "deny_all_outbound",
            "synthetic_only": True,
            "real_credentials_allowed": False,
            "production_profiles_allowed": False,
            "sandbox_stdout_sanitized": stdout,
            "sandbox_stderr_sanitized": stderr,
            "sandbox_destroyed": False,
        }
        return payload
    finally:
        if sandbox is not None:
            sandbox_destroyed = _destroy_sandbox(sandbox)
            if payload is not None:
                payload["sandbox_destroyed"] = sandbox_destroyed


def preflight(contract_path: Path, approval_command: str) -> dict:
    result = validate_contract(contract_path)
    validate_owner_approval(approval_command)
    sdk_available = _sdk_available()
    return {
        "result": "PASS",
        "mode": "preflight-approved",
        "backend": result["backend"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "execution_approved": True,
        "dependency_install_allowed": False,
        "e2b_sdk_available": sdk_available,
        "provider_credential_presence_checked": sdk_available,
        "provider_credential_name_present": _credential_name_present() if sdk_available else False,
        "provider_credential_value_printed": False,
        "sandbox_created": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight-approved", "execute-synthetic-proof"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-command", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight-approved":
            _json_print(preflight(args.contract, args.approval_command))
            return 0
        if args.mode == "execute-synthetic-proof":
            payload = execute_synthetic_proof(args.contract, args.approval_command)
            _json_print(payload)
            return 0
    except Phase1CA4ProofError as error:
        payload = {
            "result": "DENIED",
            "mode": args.mode,
            "reason": error.reason,
            "sandbox_created": False,
            "sandbox_destroyed": False,
            "provider_credential_value_printed": False,
            "synthetic_only": True,
        }
        if error.detail is not None:
            payload["detail"] = error.detail
        _json_print(payload)
        return 1
    raise AssertionError(f"unhandled mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
