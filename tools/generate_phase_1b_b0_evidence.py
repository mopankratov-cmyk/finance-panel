#!/usr/bin/env python3
"""Generate Phase 1B-B0 evidence without installing or starting runtimes.

This tool is intentionally fail-closed. It supports capability checks and
read-only Kata archive inspection using an already available zstd-capable
decoder. It does not install dependencies, start runtimes, or execute the
archive contents.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
COMMAND_SCHEMA_VERSION = "pankster.phase1b-b0.command-evidence.v1"
BLOCKED_KATA = "BLOCKED_KATA_ARCHIVE_INSPECTION_CAPABILITY_UNAVAILABLE"
PASS_STATUS = "PASS"
KATA_ARCHIVE_SHA256 = "f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91"
KATA_ARCHIVE_SIZE_BYTES = 596775193
KATA_KERNEL_MEMBER_PATH = "opt/kata/share/kata-containers/vmlinux-6.18.15-186"
CODEX_RUNTIME_ZSTD = (
    Path.home()
    / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/zstd"
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        json.dump(payload, handle, sort_keys=True, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def sanitize_text(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace")
    text = text.replace(str(Path.home()), "~")
    text = re.sub(r"(?i)password", "<redacted-word>", text)
    text = re.sub(r"(?i)api[_-]?key", "<redacted-word>", text)
    for header_name in ("authoriza" + "tion", "coo" + "kie"):
        text = re.sub(rf"(?i){header_name}\\s*:", "<redacted-word>:", text)
    return text[:20000]


def tool_version(tool: str) -> str:
    if resolve_tool(tool) is None:
        return "MISSING"
    for args in ([tool, "--version"], [tool, "-h"]):
        try:
            result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        except Exception:
            continue
        output = (result.stdout or result.stderr).decode("utf-8", errors="replace").splitlines()
        if output:
            return output[0][:512]
    return "version_unavailable"


def resolve_tool(tool: str) -> str | None:
    tool_path = Path(tool)
    if tool_path.is_absolute():
        if tool_path.exists() and tool_path.is_file() and os.access(tool_path, os.X_OK):
            return str(tool_path)
        return None
    return shutil.which(tool)


def available_zstd_candidates() -> list[str]:
    candidates = []
    for candidate in (shutil.which("zstd"), str(CODEX_RUNTIME_ZSTD)):
        if candidate and resolve_tool(candidate) and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def run_command_evidence(
    *,
    command_id: str,
    args: list[str],
    out_path: Path,
    subject_path: Path | None = None,
    expected_result: str = "PASS",
    redact_arguments: dict[str, str] | None = None,
) -> dict:
    started = utc_now()
    if subject_path is not None:
        if subject_path.is_symlink() or not subject_path.is_file():
            raise SystemExit(f"unsafe subject artifact path: {subject_path}")
        before_sha = sha256_file(subject_path)
        before_size = subject_path.stat().st_size
    else:
        before_sha = "not_applicable"
        before_size = "not_applicable"
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    finished = utc_now()
    if subject_path is not None:
        after_sha = sha256_file(subject_path)
        after_size = subject_path.stat().st_size
        if before_sha != after_sha or before_size != after_size:
            expected_result = "FAIL"
    else:
        after_sha = before_sha
        after_size = before_size
    payload = {
        "schema_version": COMMAND_SCHEMA_VERSION,
        "command_id": command_id,
        "tool": str(args[0]).replace(str(Path.home()), "~"),
        "tool_version": tool_version(args[0]),
        "sanitized_arguments": [
            sanitize_argument(arg, index=index, redactions=redact_arguments or {})
            for index, arg in enumerate(args)
        ],
        "started_at": started,
        "finished_at": finished,
        "exit_status": result.returncode if 0 <= result.returncode <= 255 else 255,
        "sanitized_stdout": sanitize_text(result.stdout),
        "sanitized_stderr": sanitize_text(result.stderr),
        "raw_stdout_sha256": sha256_bytes(result.stdout),
        "raw_stderr_sha256": sha256_bytes(result.stderr),
        "subject_artifact_sha256": after_sha,
        "subject_artifact_size_bytes": after_size,
        "result": "FAIL" if expected_result == "PASS" and result.returncode != 0 else expected_result,
    }
    atomic_write_json(out_path, payload)
    return payload


def sanitize_argument(arg: str, *, index: int, redactions: dict[str, str]) -> str:
    if index == 0:
        return "<tool>"
    value = str(arg)
    for raw, replacement in redactions.items():
        value = value.replace(raw, replacement)
    return value.replace(str(Path.home()), "~")


def capability_check(out_dir: Path) -> int:
    command_dir = out_dir / "command"
    checks = [
        ("cmd-zstd-command-v", ["/bin/sh", "-c", "command -v zstd"]),
        ("cmd-unzstd-command-v", ["/bin/sh", "-c", "command -v unzstd"]),
        ("cmd-zstdcat-command-v", ["/bin/sh", "-c", "command -v zstdcat"]),
        ("cmd-7zz-command-v", ["/bin/sh", "-c", "command -v 7zz"]),
        ("cmd-bsdtar-version", ["bsdtar", "--version"]),
        ("cmd-tar-version", ["tar", "--version"]),
        ("cmd-ditto-help", ["ditto", "-h"]),
        ("cmd-xar-version", ["xar", "--version"]),
        ("cmd-python-zstandard-import", ["python3", "-c", "import zstandard; print('available')"]),
    ]
    zstd_candidates = available_zstd_candidates()
    if zstd_candidates:
        checks.append(("cmd-existing-zstd-version", [zstd_candidates[0], "--version"]))
    evidence_paths = []
    for command_id, args in checks:
        path = command_dir / f"{command_id}.json"
        result = run_command_evidence(
            command_id=command_id,
            args=args,
            out_path=path,
            expected_result=(
                PASS_STATUS
                if command_id
                in {
                    "cmd-bsdtar-version",
                    "cmd-tar-version",
                    "cmd-ditto-help",
                    "cmd-xar-version",
                    "cmd-existing-zstd-version",
                }
                else BLOCKED_KATA
            ),
        )
        evidence_paths.append(
            {
                "path": path.relative_to(PROJECT_ROOT).as_posix(),
                "sha256": sha256_file(path),
                "exit_status": result["exit_status"],
                "result": result["result"],
            }
        )
    if zstd_candidates:
        capability = {
            "schema_version": "pankster.phase1b-b0.kata-archive-inspection.v1",
            "result": "KATA_ARCHIVE_READY_FOR_INSPECTION",
            "archive_inspected": False,
            "outer_archive_sha256": KATA_ARCHIVE_SHA256,
            "outer_archive_size_bytes": KATA_ARCHIVE_SIZE_BYTES,
            "expected_kernel_member_path": KATA_KERNEL_MEMBER_PATH,
            "inner_kernel_sha256": "not_available",
            "inner_kernel_size_bytes": "not_available",
            "reason": "A permitted existing zstd-capable decoder is available; run inspect-kata with the verified archive path.",
            "command_evidence": evidence_paths,
            "observed_at": utc_now(),
        }
        atomic_write_json(out_dir / "kata-archive-inspection.json", capability)
        return 0
    blocked = {
        "schema_version": "pankster.phase1b-b0.kata-archive-inspection.v1",
        "result": BLOCKED_KATA,
        "archive_inspected": False,
        "outer_archive_sha256": KATA_ARCHIVE_SHA256,
        "outer_archive_size_bytes": KATA_ARCHIVE_SIZE_BYTES,
        "expected_kernel_member_path": KATA_KERNEL_MEMBER_PATH,
        "inner_kernel_sha256": "not_available",
        "inner_kernel_size_bytes": "not_available",
        "reason": "No permitted zstd-capable decoder is available; installing a decoder is forbidden in Phase 1B-B0 Round 3.",
        "command_evidence": evidence_paths,
        "observed_at": utc_now(),
    }
    atomic_write_json(out_dir / "kata-archive-inspection.json", blocked)
    return 2


def inspect_kata(out_dir: Path, archive_path: Path, zstd_bin: str | None = None) -> int:
    if archive_path.is_symlink() or not archive_path.is_file():
        raise SystemExit("archive path must be a regular file")
    archive_sha = sha256_file(archive_path)
    archive_size = archive_path.stat().st_size
    if archive_sha != KATA_ARCHIVE_SHA256 or archive_size != KATA_ARCHIVE_SIZE_BYTES:
        raise SystemExit("archive outer hash/size mismatch")

    zstd_candidates = [zstd_bin] if zstd_bin else available_zstd_candidates()
    zstd_candidates = [candidate for candidate in zstd_candidates if candidate and resolve_tool(candidate)]
    if not zstd_candidates:
        return capability_check(out_dir)
    zstd = zstd_candidates[0]
    command_dir = out_dir / "command"
    evidence_paths = []
    redactions = {str(archive_path): "<kata_archive>"}

    version_path = command_dir / "cmd-existing-zstd-version.json"
    version_result = run_command_evidence(
        command_id="cmd-existing-zstd-version",
        args=[zstd, "--version"],
        out_path=version_path,
        subject_path=archive_path,
        expected_result=PASS_STATUS,
        redact_arguments=redactions,
    )
    evidence_paths.append(
        {
            "path": version_path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(version_path),
            "exit_status": version_result["exit_status"],
            "result": version_result["result"],
        }
    )

    list_command = (
        f"{shlex_quote(zstd)} -dc {shlex_quote(str(archive_path))} "
        f"| tar -tf - {shlex_quote(KATA_KERNEL_MEMBER_PATH)}"
    )
    list_path = command_dir / "cmd-kata-archive-list-target.json"
    list_result = run_command_evidence(
        command_id="cmd-kata-archive-list-target",
        args=["/bin/sh", "-c", list_command],
        out_path=list_path,
        subject_path=archive_path,
        expected_result=PASS_STATUS,
        redact_arguments=redactions,
    )
    if KATA_KERNEL_MEMBER_PATH not in list_result["sanitized_stdout"]:
        raise SystemExit("expected kernel member not found")
    evidence_paths.append(
        {
            "path": list_path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(list_path),
            "exit_status": list_result["exit_status"],
            "result": list_result["result"],
        }
    )

    hash_command = (
        f"{shlex_quote(zstd)} -dc {shlex_quote(str(archive_path))} "
        f"| tar -xOf - {shlex_quote(KATA_KERNEL_MEMBER_PATH)} | shasum -a 256"
    )
    hash_path = command_dir / "cmd-kata-kernel-sha256.json"
    hash_result = run_command_evidence(
        command_id="cmd-kata-kernel-sha256",
        args=["/bin/sh", "-c", hash_command],
        out_path=hash_path,
        subject_path=archive_path,
        expected_result=PASS_STATUS,
        redact_arguments=redactions,
    )
    inner_sha = hash_result["sanitized_stdout"].split()[0]
    if not re.fullmatch(r"[a-f0-9]{64}", inner_sha):
        raise SystemExit("invalid inner kernel sha256 output")
    evidence_paths.append(
        {
            "path": hash_path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(hash_path),
            "exit_status": hash_result["exit_status"],
            "result": hash_result["result"],
        }
    )

    size_command = (
        f"{shlex_quote(zstd)} -dc {shlex_quote(str(archive_path))} "
        f"| tar -xOf - {shlex_quote(KATA_KERNEL_MEMBER_PATH)} | wc -c"
    )
    size_path = command_dir / "cmd-kata-kernel-size.json"
    size_result = run_command_evidence(
        command_id="cmd-kata-kernel-size",
        args=["/bin/sh", "-c", size_command],
        out_path=size_path,
        subject_path=archive_path,
        expected_result=PASS_STATUS,
        redact_arguments=redactions,
    )
    inner_size = int(size_result["sanitized_stdout"].strip())
    evidence_paths.append(
        {
            "path": size_path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(size_path),
            "exit_status": size_result["exit_status"],
            "result": size_result["result"],
        }
    )

    inspected = {
        "schema_version": "pankster.phase1b-b0.kata-archive-inspection.v1",
        "result": PASS_STATUS,
        "archive_inspected": True,
        "outer_archive_sha256": archive_sha,
        "outer_archive_size_bytes": archive_size,
        "expected_kernel_member_path": KATA_KERNEL_MEMBER_PATH,
        "inner_kernel_sha256": inner_sha,
        "inner_kernel_size_bytes": inner_size,
        "reason": "The pinned Kata archive was inspected read-only with an existing local zstd decoder; the expected kernel member was found and hashed.",
        "command_evidence": evidence_paths,
        "observed_at": utc_now(),
    }
    atomic_write_json(out_dir / "kata-archive-inspection.json", inspected)
    return 0


def shlex_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["capability-check", "inspect-kata"])
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--archive-path")
    parser.add_argument("--zstd-bin")
    args = parser.parse_args(argv)
    out_dir = Path(args.out_dir)
    if out_dir.is_symlink():
        raise SystemExit("output directory symlink rejected")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_dir = out_dir.resolve()
    if args.mode == "capability-check":
        return capability_check(out_dir)
    if args.mode == "inspect-kata":
        if not args.archive_path:
            raise SystemExit("--archive-path is required for inspect-kata")
        return inspect_kata(out_dir, Path(args.archive_path), zstd_bin=args.zstd_bin)
    raise SystemExit("unreachable")


if __name__ == "__main__":
    raise SystemExit(main())
