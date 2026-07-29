#!/usr/bin/env python3
"""Phase 1B-B1 privileged installer handoff runner.

This helper is intentionally fail-closed. It does not download artifacts, does
not start Apple Container, does not create credentials, and does not run the
installer unless the operator explicitly selects ``--mode execute-install`` from
an administrator-authenticated shell.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import (
    ManifestError,
    load_json,
    validate_production_install,
    validate_synthetic_install,
)


DEFAULT_MANIFEST = PROJECT_ROOT / "docs/program/PHASE_1B_INSTALLATION_MANIFEST.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_B1_SYNTHETIC_APPROVAL_RECORD.json"
DEFAULT_INSTALL_TARGET = "/"

PKGUTIL = Path("/usr/sbin/pkgutil")
SPCTL = Path("/usr/sbin/spctl")
INSTALLER = Path("/usr/sbin/installer")

BACKEND_INSTALLER_ROLE = "backend-installer"
EXPECTED_PACKAGE_SHA256 = "0ca1c42a2269c2557efb1d82b1b38ac553e6a3a3da1b1179c439bcee1e7d6714"
EXPECTED_SIGNER_IDENTITY = "Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)"
EXPECTED_SIGNER_TEAM_ID = "UPBK2H6LZM"

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


class InstallRunnerError(RuntimeError):
    """Fail-closed runner error with a stable denial reason."""

    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


@dataclass(frozen=True)
class CommandResult:
    args: tuple[str, ...]
    returncode: int
    stdout: str
    stderr: str


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _sanitized_env() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}


def _run(args: Sequence[str], *, timeout: int = 120) -> CommandResult:
    completed = subprocess.run(
        list(args),
        check=False,
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    return CommandResult(tuple(args), completed.returncode, completed.stdout, completed.stderr)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_manifest_and_record(manifest_path: Path, approval_record_path: Path) -> tuple[dict, dict]:
    try:
        manifest = load_json(manifest_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise InstallRunnerError("MANIFEST_OR_APPROVAL_INVALID", str(error)) from error
    return manifest, record


def _backend_installer_artifact(manifest: dict) -> dict:
    for artifact in manifest.get("manifest_content", {}).get("artifacts", []):
        if artifact.get("role") == BACKEND_INSTALLER_ROLE:
            return artifact
    raise InstallRunnerError("BACKEND_INSTALLER_ARTIFACT_MISSING")


def validate_synthetic_gate(manifest_path: Path, approval_record_path: Path) -> dict:
    manifest, record = _load_manifest_and_record(manifest_path, approval_record_path)
    try:
        result = validate_synthetic_install(record, manifest)
    except ManifestError as error:
        raise InstallRunnerError("SYNTHETIC_INSTALL_GATE_DENIED", str(error)) from error
    return result


def validate_production_still_blocked(manifest_path: Path, approval_record_path: Path) -> str:
    manifest, record = _load_manifest_and_record(manifest_path, approval_record_path)
    try:
        validate_production_install(record, manifest)
    except ManifestError as error:
        return str(error)
    raise InstallRunnerError("PRODUCTION_INSTALL_UNEXPECTEDLY_ALLOWED")


def expected_backend_installer(manifest_path: Path) -> dict:
    manifest = load_json(manifest_path)
    artifact = _backend_installer_artifact(manifest)
    if artifact.get("sha256") != EXPECTED_PACKAGE_SHA256:
        raise InstallRunnerError("MANIFEST_PACKAGE_SHA_MISMATCH")
    if artifact.get("expected_signer_identity") != EXPECTED_SIGNER_IDENTITY:
        raise InstallRunnerError("MANIFEST_SIGNER_IDENTITY_MISMATCH")
    if artifact.get("expected_signer_team_id") != EXPECTED_SIGNER_TEAM_ID:
        raise InstallRunnerError("MANIFEST_SIGNER_TEAM_MISMATCH")
    return artifact


def validate_package_path(pkg_path: Path) -> Path:
    if not pkg_path.exists():
        raise InstallRunnerError("PACKAGE_NOT_FOUND", str(pkg_path))
    if pkg_path.is_symlink():
        raise InstallRunnerError("PACKAGE_SYMLINK_REJECTED", str(pkg_path))
    if not pkg_path.is_file():
        raise InstallRunnerError("PACKAGE_NOT_REGULAR_FILE", str(pkg_path))
    return pkg_path.resolve(strict=True)


def validate_package_hash(pkg_path: Path, expected_sha256: str) -> str:
    actual_sha256 = _sha256_file(pkg_path)
    if actual_sha256 != expected_sha256:
        raise InstallRunnerError("PACKAGE_SHA256_MISMATCH", actual_sha256)
    return actual_sha256


def validate_pkg_signature(pkg_path: Path, expected_identity: str, expected_team_id: str) -> CommandResult:
    result = _run([str(PKGUTIL), "--check-signature", str(pkg_path)])
    combined = f"{result.stdout}\n{result.stderr}"
    if result.returncode != 0:
        raise InstallRunnerError("PKGUTIL_SIGNATURE_CHECK_FAILED", combined.strip())
    if expected_identity not in combined:
        raise InstallRunnerError("PACKAGE_SIGNER_IDENTITY_MISMATCH")
    if expected_team_id not in combined:
        raise InstallRunnerError("PACKAGE_SIGNER_TEAM_MISMATCH")
    return result


def validate_spctl_assessment(pkg_path: Path) -> CommandResult:
    result = _run([str(SPCTL), "-a", "-vv", "-t", "install", str(pkg_path)])
    combined = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode != 0 or "accepted" not in combined:
        raise InstallRunnerError("SPCTL_ASSESSMENT_FAILED", combined.strip())
    return result


def validate_package(manifest_path: Path, pkg_path: Path) -> dict:
    artifact = expected_backend_installer(manifest_path)
    resolved_pkg = validate_package_path(pkg_path)
    package_sha256 = validate_package_hash(resolved_pkg, artifact["sha256"])
    signature = validate_pkg_signature(
        resolved_pkg,
        artifact["expected_signer_identity"],
        artifact["expected_signer_team_id"],
    )
    assessment = validate_spctl_assessment(resolved_pkg)
    return {
        "package_path": str(resolved_pkg),
        "package_sha256": package_sha256,
        "pkgutil_returncode": signature.returncode,
        "spctl_returncode": assessment.returncode,
    }


def sudo_available_without_prompt() -> bool:
    result = _run(["sudo", "-n", "true"], timeout=15)
    return result.returncode == 0


def build_admin_command(pkg_path: str, *, script_path: Path | None = None) -> list[str]:
    script = script_path or Path(__file__).resolve()
    return [
        "sudo",
        sys.executable or "python3",
        str(script),
        "--mode",
        "execute-install",
        "--pkg",
        pkg_path,
    ]


def execute_install(manifest_path: Path, approval_record_path: Path, pkg_path: Path, target: str) -> dict:
    if os.geteuid() != 0:
        raise InstallRunnerError("ADMIN_AUTHORIZATION_REQUIRED")
    synthetic_result = validate_synthetic_gate(manifest_path, approval_record_path)
    production_blocker = validate_production_still_blocked(manifest_path, approval_record_path)
    package_result = validate_package(manifest_path, pkg_path)
    result = _run([str(INSTALLER), "-pkg", package_result["package_path"], "-target", target], timeout=900)
    if result.returncode != 0:
        raise InstallRunnerError("INSTALLER_EXECUTION_FAILED", f"rc={result.returncode}")
    return {
        "result": "PASS",
        "mode": "execute-install",
        "synthetic_gate": synthetic_result.get("result"),
        "production_install_state": production_blocker,
        "package_sha256": package_result["package_sha256"],
        "installer_returncode": result.returncode,
        "container_system_start_executed": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
    }


def preflight(manifest_path: Path, approval_record_path: Path) -> dict:
    synthetic_result = validate_synthetic_gate(manifest_path, approval_record_path)
    production_blocker = validate_production_still_blocked(manifest_path, approval_record_path)
    return {
        "result": "BLOCKED_ADMIN_AUTHORIZATION_REQUIRED" if os.geteuid() != 0 else "READY_FOR_ADMIN_INSTALL",
        "mode": "preflight",
        "synthetic_gate": synthetic_result.get("result"),
        "production_install_state": production_blocker,
        "current_uid": os.geteuid(),
        "sudo_noninteractive_available": sudo_available_without_prompt(),
        "installer_execution_performed": False,
        "container_system_start_executed": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        required=True,
        choices=["preflight", "package-check", "print-admin-command", "execute-install"],
    )
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    parser.add_argument("--pkg", type=Path)
    parser.add_argument("--target", default=DEFAULT_INSTALL_TARGET)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.manifest, args.approval_record))
            return 0
        if args.mode == "print-admin-command":
            pkg = str(args.pkg) if args.pkg else "/absolute/path/to/container-1.1.0-installer-signed.pkg"
            _json_print(
                {
                    "result": "PASS",
                    "mode": args.mode,
                    "admin_command": " ".join(shlex.quote(part) for part in build_admin_command(pkg)),
                    "note": "Run only from an administrator-authenticated terminal after package-check PASS.",
                }
            )
            return 0
        if args.pkg is None:
            raise InstallRunnerError("PACKAGE_PATH_REQUIRED")
        if args.mode == "package-check":
            validate_synthetic_gate(args.manifest, args.approval_record)
            package_result = validate_package(args.manifest, args.pkg)
            _json_print({"result": "PASS", "mode": args.mode, **package_result})
            return 0
        if args.mode == "execute-install":
            _json_print(execute_install(args.manifest, args.approval_record, args.pkg, args.target))
            return 0
    except (InstallRunnerError, ManifestError, subprocess.TimeoutExpired) as error:
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
