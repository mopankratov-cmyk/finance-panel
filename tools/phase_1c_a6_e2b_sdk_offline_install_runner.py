#!/usr/bin/env python3
"""Phase 1C-A6 approved E2B SDK offline install runner.

The runner creates one isolated user-local virtualenv and installs
`e2b==2.34.0` only from the A5 locked wheelhouse. It does not call PyPI during
installation, read provider credentials, call E2B APIs, or create sandboxes.
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

from tools.phase_1c_a6_e2b_sdk_offline_install_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_VENV,
    EXPECTED_WHEELHOUSE,
    validate_contract,
)


DEFAULT_WHEELHOUSE = Path(EXPECTED_WHEELHOUSE)
DEFAULT_VENV = Path(EXPECTED_VENV)
MAX_CAPTURED_OUTPUT_CHARS = 4000
SENSITIVE_LINE_RE = re.compile(
    r"(^|\b)([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*|"
    r"ANTHROPIC_[A-Z0-9_]*|OPENAI_[A-Z0-9_]*|GLM_[A-Z0-9_]*|"
    r"GITEA_[A-Z0-9_]*|SUPABASE_[A-Z0-9_]*|TELEGRAM_[A-Z0-9_]*)\s*=",
    re.IGNORECASE,
)
BEARER_LINE_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._-]{8,}", re.IGNORECASE)

ALLOWED_ENV_KEYS = {
    "HOME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "NO_PROXY",
    "PATH",
    "SHELL",
    "TMP",
    "TMPDIR",
    "TEMP",
    "no_proxy",
}


class Phase1CA6OfflineInstallError(RuntimeError):
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
        if SENSITIVE_LINE_RE.search(line) or BEARER_LINE_RE.search(line):
            redacted_lines.append("[REDACTED_SENSITIVE_LINE]")
        else:
            redacted_lines.append(line)
    return "\n".join(redacted_lines)[:MAX_CAPTURED_OUTPUT_CHARS]


def _sanitized_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    env["PIP_NO_INPUT"] = "1"
    env["PIP_NO_INDEX"] = "1"
    return env


def _run(command: Sequence[str], *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        check=False,
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def _command_result(result: subprocess.CompletedProcess[str]) -> dict:
    return {
        "returncode": result.returncode,
        "stdout": _safe_text(result.stdout),
        "stderr": _safe_text(result.stderr),
    }


def validate_owner_approval(approval_command: str) -> None:
    if approval_command != EXPECTED_APPROVAL_COMMAND:
        raise Phase1CA6OfflineInstallError("OWNER_APPROVAL_COMMAND_MISMATCH")
    if hashlib.sha256(approval_command.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA6OfflineInstallError("OWNER_APPROVAL_COMMAND_SHA_MISMATCH")


def validate_wheelhouse(path: Path) -> Path:
    if path != DEFAULT_WHEELHOUSE:
        raise Phase1CA6OfflineInstallError("WHEELHOUSE_PATH_NOT_APPROVED", str(path))
    if not path.is_dir():
        raise Phase1CA6OfflineInstallError("WHEELHOUSE_MISSING", str(path))
    if path.is_symlink():
        raise Phase1CA6OfflineInstallError("WHEELHOUSE_SYMLINK_REJECTED", str(path))
    wheels = sorted(candidate.name for candidate in path.iterdir() if candidate.is_file() and candidate.suffix == ".whl")
    if "e2b-2.34.0-py3-none-any.whl" not in wheels:
        raise Phase1CA6OfflineInstallError("PRIMARY_WHEEL_MISSING")
    if any(candidate.is_symlink() for candidate in path.iterdir()):
        raise Phase1CA6OfflineInstallError("WHEELHOUSE_CHILD_SYMLINK_REJECTED")
    if any(candidate.is_file() and candidate.suffix != ".whl" for candidate in path.iterdir()):
        raise Phase1CA6OfflineInstallError("WHEELHOUSE_NON_WHEEL_FILE_PRESENT")
    return path


def validate_venv_target(path: Path) -> Path:
    if path != DEFAULT_VENV:
        raise Phase1CA6OfflineInstallError("VENV_PATH_NOT_APPROVED", str(path))
    if path.exists():
        raise Phase1CA6OfflineInstallError("VENV_TARGET_ALREADY_EXISTS", str(path))
    parent = path.parent
    if parent.exists() and parent.is_symlink():
        raise Phase1CA6OfflineInstallError("VENV_PARENT_SYMLINK_REJECTED", str(parent))
    parent.mkdir(parents=True, exist_ok=True)
    return path


def build_venv_command(venv: Path) -> list[str]:
    return ["python3", "-m", "venv", str(venv)]


def build_install_command(venv: Path, wheelhouse: Path) -> list[str]:
    python = venv / "bin" / "python"
    return [
        str(python),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--no-index",
        "--find-links",
        str(wheelhouse),
        "e2b==2.34.0",
    ]


def validate_install_command_scope(command: Sequence[str], wheelhouse: Path) -> None:
    if "install" not in command:
        raise Phase1CA6OfflineInstallError("PIP_INSTALL_COMMAND_MISSING")
    required = {"--no-index", "--find-links", str(wheelhouse), "e2b==2.34.0"}
    missing = sorted(part for part in required if part not in command)
    if missing:
        raise Phase1CA6OfflineInstallError("PIP_INSTALL_REQUIRED_PARTS_MISSING", missing)
    forbidden = {"--index-url", "--extra-index-url", "--upgrade", "--user"}
    present = sorted(part for part in forbidden if part in command)
    if present:
        raise Phase1CA6OfflineInstallError("PIP_INSTALL_FORBIDDEN_PARTS_PRESENT", present)


def build_version_command(venv: Path) -> list[str]:
    return [
        str(venv / "bin" / "python"),
        "-c",
        "import importlib.metadata as m; print(m.version('e2b'))",
    ]


def build_import_command(venv: Path) -> list[str]:
    return [
        str(venv / "bin" / "python"),
        "-c",
        "import e2b; print('E2B_IMPORT_OK')",
    ]


def preflight(contract_path: Path, approval_command: str, *, wheelhouse: Path = DEFAULT_WHEELHOUSE, venv: Path = DEFAULT_VENV) -> dict:
    validate_contract(contract_path)
    validate_owner_approval(approval_command)
    validate_wheelhouse(wheelhouse)
    install_command = build_install_command(venv, wheelhouse)
    validate_install_command_scope(install_command, wheelhouse)
    return {
        "result": "PASS",
        "mode": "preflight-approved",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "wheelhouse_path": str(wheelhouse),
        "venv_path": str(venv),
        "dependency_install_approved": True,
        "pypi_allowed": False,
        "network_dependency_resolution_allowed": False,
        "provider_api_calls_allowed": False,
        "sandbox_creation_allowed": False,
        "provider_credential_presence_checked": False,
        "provider_credential_value_printed": False,
        "venv_command": build_venv_command(venv),
        "pip_install_command": install_command,
    }


def execute_install(
    contract_path: Path,
    approval_command: str,
    *,
    wheelhouse: Path = DEFAULT_WHEELHOUSE,
    venv: Path = DEFAULT_VENV,
    manifest_output: Path | None = None,
) -> dict:
    preflight(contract_path, approval_command, wheelhouse=wheelhouse, venv=venv)
    validate_venv_target(venv)

    venv_command = build_venv_command(venv)
    venv_result = _run(venv_command, timeout=180)
    if venv_result.returncode != 0:
        raise Phase1CA6OfflineInstallError("VENV_CREATE_FAILED", _command_result(venv_result))

    install_command = build_install_command(venv, wheelhouse)
    validate_install_command_scope(install_command, wheelhouse)
    install_result = _run(install_command, timeout=180)
    if install_result.returncode != 0:
        raise Phase1CA6OfflineInstallError("OFFLINE_PIP_INSTALL_FAILED", _command_result(install_result))

    version_result = _run(build_version_command(venv), timeout=60)
    if version_result.returncode != 0:
        raise Phase1CA6OfflineInstallError("E2B_VERSION_VERIFY_FAILED", _command_result(version_result))
    installed_version = version_result.stdout.strip()
    if installed_version != "2.34.0":
        raise Phase1CA6OfflineInstallError("E2B_VERSION_MISMATCH", installed_version)

    import_result = _run(build_import_command(venv), timeout=60)
    if import_result.returncode != 0 or import_result.stdout.strip() != "E2B_IMPORT_OK":
        raise Phase1CA6OfflineInstallError("E2B_OFFLINE_IMPORT_VERIFY_FAILED", _command_result(import_result))

    manifest = {
        "schema_version": "pankster.phase1c-a6.e2b-sdk-offline-install-manifest.v1",
        "result": "PASS",
        "mode": "execute-install",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "wheelhouse_path": str(wheelhouse),
        "venv_path": str(venv),
        "venv_created_under_allowed_path": True,
        "pip_install_used_no_index": True,
        "pip_install_used_locked_wheelhouse": True,
        "installed_e2b_version_verified": True,
        "installed_e2b_version": installed_version,
        "offline_import_verification_passed": True,
        "provider_credential_presence_checked": False,
        "provider_credential_value_printed": False,
        "provider_api_calls_performed": False,
        "sandbox_created": False,
        "pypi_allowed": False,
        "network_dependency_resolution_allowed": False,
        "dependency_install_scope": "isolated-user-local-venv",
        "venv_command_result": _command_result(venv_result),
        "pip_install_command_result": _command_result(install_result),
        "version_command_result": _command_result(version_result),
        "import_command_result": _command_result(import_result),
        "rollback_plan_recorded": True,
        "rollback_scope": "delete A6 venv only",
        "rollback_path": str(venv),
        "sanitized": True,
    }
    if manifest_output is not None:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight-approved", "execute-install"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-command", required=True)
    parser.add_argument("--wheelhouse", type=Path, default=DEFAULT_WHEELHOUSE)
    parser.add_argument("--venv", type=Path, default=DEFAULT_VENV)
    parser.add_argument("--manifest-output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight-approved":
            _json_print(preflight(args.contract, args.approval_command, wheelhouse=args.wheelhouse, venv=args.venv))
            return 0
        if args.mode == "execute-install":
            _json_print(
                execute_install(
                    args.contract,
                    args.approval_command,
                    wheelhouse=args.wheelhouse,
                    venv=args.venv,
                    manifest_output=args.manifest_output,
                )
            )
            return 0
    except Phase1CA6OfflineInstallError as error:
        payload = {
            "result": "DENIED",
            "mode": args.mode,
            "reason": error.reason,
            "dependency_install_scope": "isolated-user-local-venv",
            "provider_credential_presence_checked": False,
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
