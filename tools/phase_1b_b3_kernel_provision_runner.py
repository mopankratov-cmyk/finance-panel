#!/usr/bin/env python3
"""Phase 1B-B3 local Kata kernel provisioning handoff runner."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_CONTRACT.ready.json"
CONTAINER = Path("/usr/local/bin/container")
EXPECTED_CONTAINER_VERSION = "container CLI version 1.1.0 (build: release, commit: 5973b9c)"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_KERNEL_PROVISION"
KATA_MEMBER = "opt/kata/share/kata-containers/vmlinux-6.18.15-186"
MAX_CAPTURED_OUTPUT_CHARS = 4000

ZSTD_CANDIDATES = [
    Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/zstd",
    Path("/opt/homebrew/bin/zstd"),
    Path("/usr/local/bin/zstd"),
]

APPROVAL_RECORD_FIELDS = {
    "approval_id",
    "contract_content_sha256",
    "decision",
    "approved_by",
    "authorization_event_id",
    "authorization_source",
    "authn_context",
    "approved_at",
    "expires_at",
    "owner_command_hash",
    "synthetic_only",
    "real_credentials_allowed",
    "production_profiles_allowed",
    "record_sha256",
}

OWNER_RE = re.compile(r"^owner:[A-Za-z0-9._-]{1,128}$")
AUTH_EVENT_RE = re.compile(r"^hgate-[A-Za-z0-9._-]{8,128}$")

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


class KernelProvisionError(RuntimeError):
    def __init__(self, reason: str, detail: object | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _sanitized_env() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}


def _run(args: Sequence[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=False,
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def _safe_output(value: str) -> str:
    return value.strip().replace("\x00", "")[:MAX_CAPTURED_OUTPUT_CHARS]


def _command_result_payload(result: subprocess.CompletedProcess[str]) -> dict:
    return {
        "returncode": result.returncode,
        "stdout": _safe_output(result.stdout),
        "stderr": _safe_output(result.stderr),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def expected_owner_command(approval_id: str, contract_hash: str) -> str:
    return f"{APPROVAL_PREFIX}:{approval_id}:{contract_hash}"


def expected_owner_command_hash(approval_id: str, contract_hash: str) -> str:
    return hashlib.sha256(expected_owner_command(approval_id, contract_hash).encode("utf-8")).hexdigest()


def record_without_hash(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "record_sha256"}


def find_zstd() -> Path:
    for candidate in ZSTD_CANDIDATES:
        if candidate.exists() and candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise KernelProvisionError("ZSTD_DECODER_NOT_AVAILABLE")


def validate_contract(contract_path: Path) -> dict:
    contract = load_json(contract_path)
    if contract.get("schema_version") != "pankster.phase1b-b3.kernel-provisioning-contract.v1":
        raise KernelProvisionError("CONTRACT_SCHEMA_VERSION_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_APPROVAL":
        raise KernelProvisionError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise KernelProvisionError("CONTRACT_CONTENT_INVALID")
    actual_content_hash = hashlib.sha256(canonical_json_bytes(content)).hexdigest()
    if contract.get("content_sha256") != actual_content_hash:
        raise KernelProvisionError("CONTRACT_CONTENT_SHA_MISMATCH", actual_content_hash)
    if content.get("synthetic_only") is not True:
        raise KernelProvisionError("CONTRACT_NOT_SYNTHETIC_ONLY")
    if content.get("backend") != "apple-container-cli" or content.get("backend_version") != "1.1.0":
        raise KernelProvisionError("CONTRACT_BACKEND_INVALID")
    kernel = content.get("kernel_artifact")
    if not isinstance(kernel, dict):
        raise KernelProvisionError("KERNEL_ARTIFACT_INVALID")
    if kernel.get("expected_member_path") != KATA_MEMBER:
        raise KernelProvisionError("KERNEL_MEMBER_PATH_MISMATCH")
    kernel_command_template(contract, Path("/tmp/kata-static-3.28.0-arm64.tar.zst"))
    return contract


def validate_installed_container() -> str:
    if not CONTAINER.exists() or CONTAINER.is_symlink() or not CONTAINER.is_file():
        raise KernelProvisionError("CONTAINER_CLI_NOT_TRUSTED")
    result = _run([str(CONTAINER), "--version"])
    version = result.stdout.strip() or result.stderr.strip()
    if result.returncode != 0 or version != EXPECTED_CONTAINER_VERSION:
        raise KernelProvisionError("CONTAINER_VERSION_MISMATCH", version)
    return version


def validate_approval_record(record_path: Path, contract: dict) -> dict:
    record = load_json(record_path)
    if set(record) != APPROVAL_RECORD_FIELDS:
        raise KernelProvisionError("APPROVAL_RECORD_FIELDS_INVALID")
    content = contract["contract_content"]
    contract_hash = contract["content_sha256"]
    if record.get("approval_id") != content.get("approval_id"):
        raise KernelProvisionError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != contract_hash:
        raise KernelProvisionError("APPROVAL_CONTRACT_HASH_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise KernelProvisionError("APPROVAL_NOT_APPROVED")
    if record.get("authorization_source") != "pankster-human-gate":
        raise KernelProvisionError("APPROVAL_SOURCE_UNTRUSTED")
    if record.get("authn_context") != "interactive-synthetic":
        raise KernelProvisionError("APPROVAL_AUTHN_CONTEXT_INVALID")
    if not isinstance(record.get("approved_by"), str) or not OWNER_RE.fullmatch(record["approved_by"]):
        raise KernelProvisionError("APPROVED_BY_INVALID")
    if not isinstance(record.get("authorization_event_id"), str) or not AUTH_EVENT_RE.fullmatch(record["authorization_event_id"]):
        raise KernelProvisionError("AUTHORIZATION_EVENT_INVALID")
    if record.get("synthetic_only") is not True:
        raise KernelProvisionError("APPROVAL_NOT_SYNTHETIC_ONLY")
    if record.get("real_credentials_allowed") is not False:
        raise KernelProvisionError("APPROVAL_REAL_CREDENTIALS_NOT_DENIED")
    if record.get("production_profiles_allowed") is not False:
        raise KernelProvisionError("APPROVAL_PRODUCTION_PROFILES_NOT_DENIED")
    if record.get("owner_command_hash") != expected_owner_command_hash(record["approval_id"], contract_hash):
        raise KernelProvisionError("OWNER_COMMAND_HASH_MISMATCH")
    expected_record_hash = hashlib.sha256(canonical_json_bytes(record_without_hash(record))).hexdigest()
    if record.get("record_sha256") != expected_record_hash:
        raise KernelProvisionError("APPROVAL_RECORD_HASH_MISMATCH")
    now = dt.datetime.now(dt.timezone.utc)
    expires_at = dt.datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
    if now >= expires_at:
        raise KernelProvisionError("APPROVAL_EXPIRED")
    return record


def validate_archive_path(path: Path) -> Path:
    if not path.exists():
        raise KernelProvisionError("KATA_ARCHIVE_NOT_FOUND", str(path))
    if path.is_symlink():
        raise KernelProvisionError("KATA_ARCHIVE_SYMLINK_REJECTED", str(path))
    if not path.is_file():
        raise KernelProvisionError("KATA_ARCHIVE_NOT_REGULAR_FILE", str(path))
    resolved = path.resolve(strict=True)
    if "://" in str(resolved):
        raise KernelProvisionError("KATA_ARCHIVE_REMOTE_URL_REJECTED")
    return resolved


def inspect_kernel_member(archive_path: Path, member_path: str) -> dict:
    zstd = find_zstd()
    zstd_process = subprocess.Popen(
        [str(zstd), "-dc", str(archive_path)],
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert zstd_process.stdout is not None
    tar_process = subprocess.run(
        ["/usr/bin/tar", "-xOf", "-", member_path],
        check=False,
        env=_sanitized_env(),
        stdin=zstd_process.stdout,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    zstd_process.stdout.close()
    zstd_stderr = zstd_process.stderr.read() if zstd_process.stderr else b""
    zstd_returncode = zstd_process.wait()
    if zstd_returncode != 0:
        raise KernelProvisionError("KATA_ARCHIVE_DECOMPRESSION_FAILED", zstd_stderr.decode("utf-8", errors="replace"))
    if tar_process.returncode != 0:
        raise KernelProvisionError("KATA_KERNEL_MEMBER_EXTRACT_FAILED", tar_process.stderr.decode("utf-8", errors="replace"))
    return {
        "member_path": member_path,
        "sha256": hashlib.sha256(tar_process.stdout).hexdigest(),
        "size_bytes": len(tar_process.stdout),
    }


def validate_kata_archive(contract: dict, kata_archive_path: Path) -> dict:
    kernel = contract["contract_content"]["kernel_artifact"]
    resolved = validate_archive_path(kata_archive_path)
    if resolved.name != kernel["archive_name"]:
        raise KernelProvisionError("KATA_ARCHIVE_NAME_MISMATCH", resolved.name)
    stat = resolved.stat()
    if stat.st_size != kernel["archive_size_bytes"]:
        raise KernelProvisionError("KATA_ARCHIVE_SIZE_MISMATCH", stat.st_size)
    archive_sha256 = sha256_file(resolved)
    if archive_sha256 != kernel["archive_sha256"]:
        raise KernelProvisionError("KATA_ARCHIVE_SHA256_MISMATCH", archive_sha256)
    member = inspect_kernel_member(resolved, kernel["expected_member_path"])
    if member["sha256"] != kernel["inner_kernel_sha256"]:
        raise KernelProvisionError("KATA_INNER_KERNEL_SHA256_MISMATCH", member["sha256"])
    if member["size_bytes"] != kernel["inner_kernel_size_bytes"]:
        raise KernelProvisionError("KATA_INNER_KERNEL_SIZE_MISMATCH", member["size_bytes"])
    return {
        "archive_path": str(resolved),
        "archive_sha256": archive_sha256,
        "archive_size_bytes": stat.st_size,
        "kernel_member": member,
    }


def kernel_command_template(contract: dict, kata_archive_path: Path) -> list[str]:
    template = contract["contract_content"].get("runtime_kernel_command_template")
    if not isinstance(template, list) or not all(isinstance(part, str) and part for part in template):
        raise KernelProvisionError("KERNEL_COMMAND_TEMPLATE_INVALID")
    if "--recommended" in template:
        raise KernelProvisionError("KERNEL_COMMAND_RECOMMENDED_DOWNLOAD_REJECTED")
    if "start" in template or "run" in template or "create" in template:
        raise KernelProvisionError("KERNEL_COMMAND_SCOPE_VIOLATION")
    expected_prefix = [str(CONTAINER), "system", "kernel", "set", "--arch", "arm64", "--tar"]
    if template[:7] != expected_prefix:
        raise KernelProvisionError("KERNEL_COMMAND_TEMPLATE_NOT_ALLOWED")
    if "<verified-local-kata-archive>" not in template:
        raise KernelProvisionError("KERNEL_COMMAND_TEMPLATE_MISSING_ARCHIVE_PLACEHOLDER")
    return [str(kata_archive_path) if part == "<verified-local-kata-archive>" else part for part in template]


def preflight(contract_path: Path) -> dict:
    contract = validate_contract(contract_path)
    version = validate_installed_container()
    return {
        "result": "OWNER_APPROVAL_REQUIRED",
        "mode": "preflight",
        "approval_command": expected_owner_command(
            contract["contract_content"]["approval_id"],
            contract["content_sha256"],
        ),
        "container_cli_version": version,
        "runtime_start_executed": False,
        "kernel_provision_executed": False,
        "workload_started": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
    }


def build_admin_command(kata_archive_path: str, record_path: str, *, contract_path: Path | None = None, script_path: Path | None = None) -> list[str]:
    script = script_path or Path(__file__).resolve()
    contract = contract_path or DEFAULT_CONTRACT
    return [
        "sudo",
        sys.executable or "python3",
        str(script),
        "--mode",
        "execute-provision",
        "--contract",
        str(contract),
        "--kata-archive",
        kata_archive_path,
        "--approval-record",
        record_path,
    ]


def execute_provision(contract_path: Path, approval_record_path: Path, kata_archive_path: Path) -> dict:
    if os.geteuid() != 0:
        raise KernelProvisionError("ADMIN_AUTHORIZATION_REQUIRED")
    contract = validate_contract(contract_path)
    validate_approval_record(approval_record_path, contract)
    version = validate_installed_container()
    archive = validate_kata_archive(contract, kata_archive_path)
    command = kernel_command_template(contract, Path(archive["archive_path"]))
    result = _run(command, timeout=300)
    if result.returncode != 0:
        raise KernelProvisionError("KERNEL_PROVISION_FAILED", _command_result_payload(result))
    return {
        "result": "PASS",
        "mode": "execute-provision",
        "container_cli_version": version,
        "kernel_command": command,
        "kernel_provision_returncode": result.returncode,
        "archive_sha256": archive["archive_sha256"],
        "kernel_member": archive["kernel_member"],
        "kernel_provision_executed": True,
        "runtime_start_executed": False,
        "workload_started": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "artifact-check", "print-approval-command", "print-admin-command", "execute-provision"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path)
    parser.add_argument("--kata-archive", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.contract))
            return 0
        contract = validate_contract(args.contract)
        if args.mode == "print-approval-command":
            _json_print(
                {
                    "result": "PASS",
                    "mode": args.mode,
                    "approval_command": expected_owner_command(
                        contract["contract_content"]["approval_id"],
                        contract["content_sha256"],
                    ),
                    "note": "Owner must send this exact command before kernel provisioning.",
                }
            )
            return 0
        if args.mode == "artifact-check":
            if args.kata_archive is None:
                raise KernelProvisionError("KATA_ARCHIVE_REQUIRED")
            _json_print({"result": "PASS", "mode": args.mode, **validate_kata_archive(contract, args.kata_archive)})
            return 0
        if args.mode == "print-admin-command":
            if args.kata_archive is None:
                raise KernelProvisionError("KATA_ARCHIVE_REQUIRED")
            record = str(args.approval_record) if args.approval_record else "docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_APPROVAL_RECORD.json"
            _json_print(
                {
                    "result": "PASS",
                    "mode": args.mode,
                    "admin_command": " ".join(shlex.quote(part) for part in build_admin_command(str(args.kata_archive), record, contract_path=args.contract)),
                    "note": "Run only after artifact-check PASS and committed approval record validation.",
                }
            )
            return 0
        if args.approval_record is None:
            raise KernelProvisionError("APPROVAL_RECORD_REQUIRED")
        if args.kata_archive is None:
            raise KernelProvisionError("KATA_ARCHIVE_REQUIRED")
        _json_print(execute_provision(args.contract, args.approval_record, args.kata_archive))
        return 0
    except (KernelProvisionError, subprocess.TimeoutExpired) as error:
        reason = getattr(error, "reason", error.__class__.__name__)
        detail = getattr(error, "detail", str(error))
        payload = {"result": "DENIED", "mode": args.mode, "reason": reason}
        if isinstance(detail, dict):
            payload["command_result"] = detail
        elif detail and detail != reason:
            payload["detail"] = detail
        _json_print(payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
