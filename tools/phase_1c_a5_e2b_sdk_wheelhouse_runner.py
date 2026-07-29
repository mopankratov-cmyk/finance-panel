#!/usr/bin/env python3
"""Phase 1C-A5 approved E2B SDK wheelhouse lock runner.

This runner performs only the A5-approved dependency action: download a
hash-recorded wheelhouse for `e2b==2.34.0`. It never installs packages, imports
E2B, creates sandboxes, calls provider APIs, reads credentials, or prints
environment values.
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

from tools.phase_1c_a5_e2b_sdk_wheelhouse_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_PRIMARY_WHEEL_SHA,
    validate_contract,
)


DEFAULT_WHEELHOUSE = Path("/Users/maksimpankratov/.local/pankster/e2b-sdk-wheelhouse/2.34.0")
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


class Phase1CA5WheelhouseError(RuntimeError):
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
    return env


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_owner_approval(approval_command: str) -> None:
    if approval_command != EXPECTED_APPROVAL_COMMAND:
        raise Phase1CA5WheelhouseError("OWNER_APPROVAL_COMMAND_MISMATCH")
    if hashlib.sha256(approval_command.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_COMMAND_SHA:
        raise Phase1CA5WheelhouseError("OWNER_APPROVAL_COMMAND_SHA_MISMATCH")


def validate_wheelhouse_path(path: Path) -> Path:
    if path.exists() and path.is_symlink():
        raise Phase1CA5WheelhouseError("WHEELHOUSE_SYMLINK_REJECTED", str(path))
    parent = path.parent
    if parent.exists() and parent.is_symlink():
        raise Phase1CA5WheelhouseError("WHEELHOUSE_PARENT_SYMLINK_REJECTED", str(parent))
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise Phase1CA5WheelhouseError("WHEELHOUSE_NOT_DIRECTORY", str(path))
    for child in path.iterdir():
        if child.is_symlink():
            raise Phase1CA5WheelhouseError("WHEELHOUSE_CHILD_SYMLINK_REJECTED", child.name)
        if child.is_file() and child.suffix != ".whl":
            raise Phase1CA5WheelhouseError("WHEELHOUSE_NON_WHEEL_FILE_PRESENT", child.name)
    return path


def build_pip_download_command(wheelhouse: Path) -> list[str]:
    return [
        sys.executable or "python3",
        "-m",
        "pip",
        "download",
        "--disable-pip-version-check",
        "--no-input",
        "--no-cache-dir",
        "--only-binary",
        ":all:",
        "--index-url",
        "https://pypi.org/simple",
        "--dest",
        str(wheelhouse),
        "e2b==2.34.0",
    ]


def validate_pip_command_scope(command: Sequence[str]) -> None:
    joined = " ".join(command)
    if " install " in joined or " uninstall " in joined:
        raise Phase1CA5WheelhouseError("PIP_COMMAND_INSTALL_SCOPE_VIOLATION")
    required = {"download", "--only-binary", ":all:", "--no-cache-dir", "e2b==2.34.0"}
    missing = sorted(part for part in required if part not in command)
    if missing:
        raise Phase1CA5WheelhouseError("PIP_COMMAND_REQUIRED_PARTS_MISSING", missing)


def _parse_wheel_name(filename: str) -> tuple[str, str]:
    parts = filename.split("-")
    if len(parts) < 5 or not filename.endswith(".whl"):
        raise Phase1CA5WheelhouseError("WHEEL_FILENAME_INVALID", filename)
    return parts[0].replace("_", "-").lower(), parts[1]


def build_wheelhouse_manifest(wheelhouse: Path) -> dict:
    wheels = []
    for path in sorted(wheelhouse.iterdir(), key=lambda candidate: candidate.name.lower()):
        if path.is_symlink():
            raise Phase1CA5WheelhouseError("WHEELHOUSE_CHILD_SYMLINK_REJECTED", path.name)
        if not path.is_file():
            continue
        if path.suffix != ".whl":
            raise Phase1CA5WheelhouseError("WHEELHOUSE_NON_WHEEL_FILE_PRESENT", path.name)
        package_name, version = _parse_wheel_name(path.name)
        digest = _sha256_file(path)
        wheels.append(
            {
                "filename": path.name,
                "package": package_name,
                "version": version,
                "sha256": digest,
                "size_bytes": path.stat().st_size,
            }
        )

    primary = next((wheel for wheel in wheels if wheel["filename"] == "e2b-2.34.0-py3-none-any.whl"), None)
    if primary is None:
        raise Phase1CA5WheelhouseError("PRIMARY_WHEEL_MISSING")
    if primary["sha256"] != EXPECTED_PRIMARY_WHEEL_SHA:
        raise Phase1CA5WheelhouseError("PRIMARY_WHEEL_SHA_MISMATCH")
    if any(not wheel["version"] for wheel in wheels):
        raise Phase1CA5WheelhouseError("WHEEL_VERSION_PIN_MISSING")

    return {
        "schema_version": "pankster.phase1c-a5.e2b-sdk-wheelhouse-manifest.v1",
        "result": "PASS",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "wheelhouse_path": str(wheelhouse),
        "package": "e2b==2.34.0",
        "primary_wheel_sha_verified": True,
        "all_downloaded_files_sha256": True,
        "all_packages_pinned_exact_versions": True,
        "no_sdist_downloaded": True,
        "no_package_installed_or_imported": True,
        "provider_api_calls_performed": False,
        "sandbox_created": False,
        "dependency_install_allowed": False,
        "dependency_import_allowed": False,
        "wheels": wheels,
    }


def preflight(contract_path: Path, approval_command: str, wheelhouse: Path = DEFAULT_WHEELHOUSE) -> dict:
    validate_contract(contract_path)
    validate_owner_approval(approval_command)
    command = build_pip_download_command(wheelhouse)
    validate_pip_command_scope(command)
    return {
        "result": "PASS",
        "mode": "preflight-approved",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_COMMAND_SHA,
        "wheelhouse_path": str(wheelhouse),
        "dependency_download_approved": True,
        "dependency_install_allowed": False,
        "dependency_import_allowed": False,
        "provider_api_calls_allowed": False,
        "sandbox_creation_allowed": False,
        "pip_command_scope": "download-only",
        "pip_command": command,
    }


def execute_download(
    contract_path: Path,
    approval_command: str,
    *,
    wheelhouse: Path = DEFAULT_WHEELHOUSE,
    manifest_output: Path | None = None,
) -> dict:
    preflight(contract_path, approval_command, wheelhouse)
    wheelhouse = validate_wheelhouse_path(wheelhouse)
    command = build_pip_download_command(wheelhouse)
    result = subprocess.run(
        command,
        check=False,
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise Phase1CA5WheelhouseError(
            "PIP_DOWNLOAD_FAILED",
            {
                "returncode": result.returncode,
                "stdout": _safe_text(result.stdout),
                "stderr": _safe_text(result.stderr),
            },
        )
    manifest = build_wheelhouse_manifest(wheelhouse)
    manifest["mode"] = "execute-download"
    manifest["pip_returncode"] = result.returncode
    manifest["pip_stdout_sanitized"] = _safe_text(result.stdout)
    manifest["pip_stderr_sanitized"] = _safe_text(result.stderr)
    if manifest_output is not None:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight-approved", "execute-download"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-command", required=True)
    parser.add_argument("--wheelhouse", type=Path, default=DEFAULT_WHEELHOUSE)
    parser.add_argument("--manifest-output", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight-approved":
            _json_print(preflight(args.contract, args.approval_command, args.wheelhouse))
            return 0
        if args.mode == "execute-download":
            _json_print(
                execute_download(
                    args.contract,
                    args.approval_command,
                    wheelhouse=args.wheelhouse,
                    manifest_output=args.manifest_output,
                )
            )
            return 0
    except Phase1CA5WheelhouseError as error:
        payload = {
            "result": "DENIED",
            "mode": args.mode,
            "reason": error.reason,
            "dependency_install_allowed": False,
            "dependency_import_allowed": False,
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
