#!/usr/bin/env python3
"""Phase 1B-C1 Lima-vz user-local installer runner.

This helper is intentionally fail-closed. It may download only C1-pinned Lima
metadata/archive artifacts and extract only the verified Lima archive into the
approved user-local prefix. It does not start Lima, create a VM, download the
guest image, touch profiles, touch credentials, change PATH, or restart gateway.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import ManifestError, load_json, validate_production_install, validate_synthetic_install


DEFAULT_MANIFEST = PROJECT_ROOT / "docs/program/PHASE_1B_C1_LIMA_VZ_INSTALLATION_MANIFEST.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C1_LIMA_VZ_INSTALL_APPROVAL_RECORD.json"
DEFAULT_INSTALL_PREFIX = Path("/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0")

BACKEND_INSTALLER_ROLE = "backend-installer"
CHECKSUMS_ROLE = "release-checksums"
TEMPLATE_ROLE = "lima-template"
GUEST_IMAGE_ROLE = "guest-image"

CURL = Path("/usr/bin/curl")

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


class LimaInstallRunnerError(RuntimeError):
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


def _run(args: Sequence[str], *, timeout: int = 300) -> CommandResult:
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
        raise LimaInstallRunnerError("MANIFEST_OR_APPROVAL_INVALID", str(error)) from error
    return manifest, record


def _artifact_by_role(manifest: dict, role: str) -> dict:
    for artifact in manifest.get("manifest_content", {}).get("artifacts", []):
        if artifact.get("role") == role:
            return artifact
    raise LimaInstallRunnerError("ARTIFACT_ROLE_MISSING", role)


def validate_synthetic_gate(manifest_path: Path, approval_record_path: Path) -> dict:
    manifest, record = _load_manifest_and_record(manifest_path, approval_record_path)
    try:
        result = validate_synthetic_install(record, manifest)
    except ManifestError as error:
        raise LimaInstallRunnerError("SYNTHETIC_INSTALL_GATE_DENIED", str(error)) from error
    return result


def validate_production_still_blocked(manifest_path: Path, approval_record_path: Path) -> str:
    manifest, record = _load_manifest_and_record(manifest_path, approval_record_path)
    try:
        validate_production_install(record, manifest)
    except ManifestError as error:
        return str(error)
    raise LimaInstallRunnerError("PRODUCTION_INSTALL_UNEXPECTEDLY_ALLOWED")


def _validate_install_prefix(path: Path) -> Path:
    if not path.is_absolute():
        raise LimaInstallRunnerError("INSTALL_PREFIX_NOT_ABSOLUTE")
    allowed_root = Path("/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz")
    try:
        path.relative_to(allowed_root)
    except ValueError as error:
        raise LimaInstallRunnerError("INSTALL_PREFIX_OUT_OF_SCOPE", str(path)) from error
    if path == allowed_root:
        raise LimaInstallRunnerError("INSTALL_PREFIX_TOO_BROAD")
    return path


def _validate_expected_backend(manifest: dict) -> None:
    content = manifest.get("manifest_content", {})
    if content.get("backend") != "lima-vz":
        raise LimaInstallRunnerError("UNEXPECTED_BACKEND")
    if content.get("backend_version") != "2.2.0":
        raise LimaInstallRunnerError("UNEXPECTED_BACKEND_VERSION")


def _download(url: str, destination: Path) -> None:
    if destination.exists():
        raise LimaInstallRunnerError("DOWNLOAD_DESTINATION_EXISTS", str(destination))
    partial = destination.with_name(f"{destination.name}.partial")
    last_result: CommandResult | None = None
    variants = [("--http1.1",), ()]
    for variant in variants:
        for _attempt in range(3):
            if partial.exists():
                partial.unlink()
            result = _run(
                [
                    str(CURL),
                    *variant,
                    "--proto",
                    "=https",
                    "--fail",
                    "--show-error",
                    "--location",
                    "--silent",
                    "--connect-timeout",
                    "30",
                    "--max-time",
                    "600",
                    "--output",
                    str(partial),
                    url,
                ],
                timeout=660,
            )
            last_result = result
            if result.returncode == 0:
                os.replace(partial, destination)
                return
            if partial.exists():
                partial.unlink()
    detail = f"rc={last_result.returncode}" if last_result else "no attempts"
    raise LimaInstallRunnerError("DOWNLOAD_FAILED", detail)


def _verify_file(path: Path, artifact: dict) -> str:
    if not path.is_file() or path.is_symlink():
        raise LimaInstallRunnerError("ARTIFACT_FILE_INVALID", str(path))
    expected_size = artifact["size_bytes"]
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise LimaInstallRunnerError("ARTIFACT_SIZE_MISMATCH", f"{path.name}:{actual_size}")
    actual_sha256 = _sha256_file(path)
    if actual_sha256 != artifact["sha256"]:
        raise LimaInstallRunnerError("ARTIFACT_SHA256_MISMATCH", f"{path.name}:{actual_sha256}")
    return actual_sha256


def _verify_checksums_file(checksums_path: Path, installer_artifact: dict) -> None:
    text = checksums_path.read_text(encoding="utf-8")
    expected_line = f"{installer_artifact['sha256']}  {installer_artifact['name']}"
    if expected_line not in text.splitlines():
        raise LimaInstallRunnerError("SHA256SUMS_INSTALLER_LINE_MISSING")


def _safe_member_name(member: tarfile.TarInfo) -> str:
    name = member.name
    if not name or name.startswith("/") or "\\" in name:
        raise LimaInstallRunnerError("ARCHIVE_MEMBER_PATH_REJECTED", name)
    normalized = posixpath.normpath(name)
    if normalized == ".":
        if member.isdir():
            return normalized
        raise LimaInstallRunnerError("ARCHIVE_MEMBER_PATH_REJECTED", name)
    if normalized == ".." or normalized.startswith("../") or "/../" in normalized:
        raise LimaInstallRunnerError("ARCHIVE_MEMBER_PATH_REJECTED", name)
    return normalized


def _safe_link_target(member: tarfile.TarInfo) -> None:
    if not (member.issym() or member.islnk()):
        return
    linkname = member.linkname
    if not linkname or linkname.startswith("/") or "\\" in linkname:
        raise LimaInstallRunnerError("ARCHIVE_LINK_TARGET_REJECTED", member.name)
    member_name = _safe_member_name(member)
    member_dir = posixpath.dirname(member_name)
    resolved = posixpath.normpath(posixpath.join(member_dir, linkname))
    if resolved in {".", ".."} or resolved.startswith("../") or "/../" in resolved:
        raise LimaInstallRunnerError("ARCHIVE_LINK_TARGET_REJECTED", member.name)


def inspect_archive(archive_path: Path) -> dict:
    members = 0
    files = 0
    directories = 0
    links = 0
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            members += 1
            _safe_member_name(member)
            _safe_link_target(member)
            if member.isdir():
                directories += 1
                continue
            if member.isfile():
                files += 1
                continue
            if member.issym() or member.islnk():
                links += 1
                continue
            raise LimaInstallRunnerError("ARCHIVE_MEMBER_TYPE_REJECTED", member.name)
    if members == 0:
        raise LimaInstallRunnerError("ARCHIVE_EMPTY")
    return {"members": members, "files": files, "directories": directories, "links": links}


def _remove_stage(stage: Path) -> None:
    if stage.exists():
        if stage.parent != DEFAULT_INSTALL_PREFIX.parent or not stage.name.startswith(f".{DEFAULT_INSTALL_PREFIX.name}.partial-"):
            raise LimaInstallRunnerError("UNSAFE_STAGE_CLEANUP_REFUSED", str(stage))
        shutil.rmtree(stage)


def extract_archive(archive_path: Path, install_prefix: Path) -> dict:
    install_prefix = _validate_install_prefix(install_prefix)
    if install_prefix.exists():
        raise LimaInstallRunnerError("INSTALL_PREFIX_ALREADY_EXISTS", str(install_prefix))
    parent = install_prefix.parent
    parent.mkdir(parents=True, exist_ok=True)
    stage = parent / f".{install_prefix.name}.partial-{os.getpid()}"
    if stage.exists():
        raise LimaInstallRunnerError("INSTALL_STAGE_ALREADY_EXISTS", str(stage))
    stage.mkdir(mode=0o755)
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            for member in archive.getmembers():
                _safe_member_name(member)
                _safe_link_target(member)
                archive.extract(member, path=stage)
        os.replace(stage, install_prefix)
    except Exception:
        _remove_stage(stage)
        raise
    limactl_path = install_prefix / "bin" / "limactl"
    lima_path = install_prefix / "bin" / "lima"
    for binary in (limactl_path, lima_path):
        if not binary.is_file():
            raise LimaInstallRunnerError("EXPECTED_BINARY_MISSING", str(binary))
        mode = binary.stat().st_mode
        if not (mode & stat.S_IXUSR):
            raise LimaInstallRunnerError("EXPECTED_BINARY_NOT_EXECUTABLE", str(binary))
    return {
        "install_prefix": str(install_prefix),
        "limactl_path": str(limactl_path),
        "lima_path": str(lima_path),
    }


def preflight(manifest_path: Path, approval_record_path: Path, install_prefix: Path) -> dict:
    manifest, _record = _load_manifest_and_record(manifest_path, approval_record_path)
    _validate_expected_backend(manifest)
    synthetic_result = validate_synthetic_gate(manifest_path, approval_record_path)
    production_blocker = validate_production_still_blocked(manifest_path, approval_record_path)
    install_prefix = _validate_install_prefix(install_prefix)
    return {
        "result": "PASS",
        "mode": "preflight",
        "synthetic_gate": synthetic_result.get("result"),
        "production_install_state": production_blocker,
        "install_prefix": str(install_prefix),
        "install_prefix_exists": install_prefix.exists(),
        "runtime_start_executed": False,
        "guest_image_downloaded": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
    }


def execute_install(manifest_path: Path, approval_record_path: Path, install_prefix: Path) -> dict:
    manifest, _record = _load_manifest_and_record(manifest_path, approval_record_path)
    _validate_expected_backend(manifest)
    synthetic_result = validate_synthetic_gate(manifest_path, approval_record_path)
    production_blocker = validate_production_still_blocked(manifest_path, approval_record_path)
    installer_artifact = _artifact_by_role(manifest, BACKEND_INSTALLER_ROLE)
    checksums_artifact = _artifact_by_role(manifest, CHECKSUMS_ROLE)
    template_artifact = _artifact_by_role(manifest, TEMPLATE_ROLE)
    guest_image_artifact = _artifact_by_role(manifest, GUEST_IMAGE_ROLE)

    with tempfile.TemporaryDirectory(prefix="pankster-lima-c1-") as temp:
        tempdir = Path(temp)
        archive_path = tempdir / installer_artifact["name"]
        checksums_path = tempdir / checksums_artifact["name"]
        template_path = tempdir / template_artifact["name"]
        _download(installer_artifact["source_url"], archive_path)
        _download(checksums_artifact["source_url"], checksums_path)
        _download(template_artifact["source_url"], template_path)
        archive_sha256 = _verify_file(archive_path, installer_artifact)
        checksums_sha256 = _verify_file(checksums_path, checksums_artifact)
        template_sha256 = _verify_file(template_path, template_artifact)
        _verify_checksums_file(checksums_path, installer_artifact)
        archive_inspection = inspect_archive(archive_path)
        extraction = extract_archive(archive_path, install_prefix)

    return {
        "result": "PASS",
        "mode": "execute-install",
        "synthetic_gate": synthetic_result.get("result"),
        "production_install_state": production_blocker,
        "archive_sha256": archive_sha256,
        "checksums_sha256": checksums_sha256,
        "template_sha256": template_sha256,
        "archive_inspection": archive_inspection,
        "guest_image_candidate_sha256": guest_image_artifact["sha256"],
        "guest_image_downloaded": False,
        "runtime_start_executed": False,
        "limactl_start_executed": False,
        "vm_created": False,
        "path_modified": False,
        "gateway_changed": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
        **extraction,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "execute-install"])
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    parser.add_argument("--install-prefix", type=Path, default=DEFAULT_INSTALL_PREFIX)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.manifest, args.approval_record, args.install_prefix))
            return 0
        if args.mode == "execute-install":
            _json_print(execute_install(args.manifest, args.approval_record, args.install_prefix))
            return 0
    except (LimaInstallRunnerError, ManifestError, subprocess.TimeoutExpired, tarfile.TarError) as error:
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
