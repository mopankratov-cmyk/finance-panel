#!/usr/bin/env python3
"""Phase 1B-B2 synthetic runtime-start handoff runner."""

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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_CONTRACT.ready.json"
DEFAULT_POST_INSTALL_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1b-b1/post-install-summary.json"
CONTAINER = Path("/usr/local/bin/container")
EXPECTED_CONTAINER_VERSION = "container CLI version 1.1.0 (build: release, commit: 5973b9c)"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_RUNTIME_START"
MAX_CAPTURED_OUTPUT_CHARS = 4000

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


class RuntimeStartError(RuntimeError):
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


def validate_contract(contract_path: Path, post_install_evidence_path: Path = DEFAULT_POST_INSTALL_EVIDENCE) -> dict:
    contract = load_json(contract_path)
    if contract.get("schema_version") != "pankster.phase1b-b2.synthetic-runtime-start-contract.v1":
        raise RuntimeStartError("CONTRACT_SCHEMA_VERSION_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_APPROVAL":
        raise RuntimeStartError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise RuntimeStartError("CONTRACT_CONTENT_INVALID")
    actual_content_hash = hashlib.sha256(canonical_json_bytes(content)).hexdigest()
    if contract.get("content_sha256") != actual_content_hash:
        raise RuntimeStartError("CONTRACT_CONTENT_SHA_MISMATCH", actual_content_hash)
    if content.get("synthetic_only") is not True:
        raise RuntimeStartError("CONTRACT_NOT_SYNTHETIC_ONLY")
    if content.get("backend") != "apple-container-cli" or content.get("backend_version") != "1.1.0":
        raise RuntimeStartError("CONTRACT_BACKEND_INVALID")
    if content.get("post_install_evidence_sha256") != sha256_file(post_install_evidence_path):
        raise RuntimeStartError("POST_INSTALL_EVIDENCE_SHA_MISMATCH")
    runtime_start_command(contract)
    return contract


def runtime_start_command(contract: dict) -> list[str]:
    command = contract["contract_content"].get("runtime_start_command")
    if not isinstance(command, list) or not all(isinstance(part, str) and part for part in command):
        raise RuntimeStartError("RUNTIME_START_COMMAND_INVALID")
    if command[:3] != [str(CONTAINER), "system", "start"]:
        raise RuntimeStartError("RUNTIME_START_COMMAND_NOT_ALLOWED")
    denied_parts = {"run", "create", "pull", "login", "build", "push"}
    if any(part in denied_parts for part in command):
        raise RuntimeStartError("RUNTIME_START_COMMAND_SCOPE_VIOLATION")
    if "--disable-kernel-install" not in command:
        raise RuntimeStartError("RUNTIME_START_KERNEL_POLICY_MISSING")
    return command


def validate_installed_container() -> str:
    if not CONTAINER.exists() or CONTAINER.is_symlink() or not CONTAINER.is_file():
        raise RuntimeStartError("CONTAINER_CLI_NOT_TRUSTED")
    result = _run([str(CONTAINER), "--version"])
    version = result.stdout.strip() or result.stderr.strip()
    if result.returncode != 0 or version != EXPECTED_CONTAINER_VERSION:
        raise RuntimeStartError("CONTAINER_VERSION_MISMATCH", version)
    return version


def validate_approval_record(record_path: Path, contract: dict) -> dict:
    record = load_json(record_path)
    if set(record) != APPROVAL_RECORD_FIELDS:
        raise RuntimeStartError("APPROVAL_RECORD_FIELDS_INVALID")
    content = contract["contract_content"]
    contract_hash = contract["content_sha256"]
    if record.get("approval_id") != content.get("approval_id"):
        raise RuntimeStartError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != contract_hash:
        raise RuntimeStartError("APPROVAL_CONTRACT_HASH_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise RuntimeStartError("APPROVAL_NOT_APPROVED")
    if record.get("authorization_source") != "pankster-human-gate":
        raise RuntimeStartError("APPROVAL_SOURCE_UNTRUSTED")
    if record.get("authn_context") != "interactive-synthetic":
        raise RuntimeStartError("APPROVAL_AUTHN_CONTEXT_INVALID")
    if not isinstance(record.get("approved_by"), str) or not OWNER_RE.fullmatch(record["approved_by"]):
        raise RuntimeStartError("APPROVED_BY_INVALID")
    if not isinstance(record.get("authorization_event_id"), str) or not AUTH_EVENT_RE.fullmatch(record["authorization_event_id"]):
        raise RuntimeStartError("AUTHORIZATION_EVENT_INVALID")
    if record.get("synthetic_only") is not True:
        raise RuntimeStartError("APPROVAL_NOT_SYNTHETIC_ONLY")
    if record.get("real_credentials_allowed") is not False:
        raise RuntimeStartError("APPROVAL_REAL_CREDENTIALS_NOT_DENIED")
    if record.get("production_profiles_allowed") is not False:
        raise RuntimeStartError("APPROVAL_PRODUCTION_PROFILES_NOT_DENIED")
    if record.get("owner_command_hash") != expected_owner_command_hash(record["approval_id"], contract_hash):
        raise RuntimeStartError("OWNER_COMMAND_HASH_MISMATCH")
    expected_record_hash = hashlib.sha256(canonical_json_bytes(record_without_hash(record))).hexdigest()
    if record.get("record_sha256") != expected_record_hash:
        raise RuntimeStartError("APPROVAL_RECORD_HASH_MISMATCH")
    now = dt.datetime.now(dt.timezone.utc)
    expires_at = dt.datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
    if now >= expires_at:
        raise RuntimeStartError("APPROVAL_EXPIRED")
    return record


def runtime_status() -> dict:
    result = _run([str(CONTAINER), "system", "status"], timeout=60)
    return {
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


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
        "runtime_start_command": runtime_start_command(contract),
        "runtime_status": runtime_status(),
        "runtime_start_executed": False,
        "workload_started": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
    }


def build_admin_command(record_path: str, *, contract_path: Path | None = None, script_path: Path | None = None) -> list[str]:
    script = script_path or Path(__file__).resolve()
    contract = contract_path or DEFAULT_CONTRACT
    return [
        "sudo",
        sys.executable or "python3",
        str(script),
        "--mode",
        "execute-start",
        "--contract",
        str(contract),
        "--approval-record",
        record_path,
    ]


def execute_start(contract_path: Path, approval_record_path: Path) -> dict:
    if os.geteuid() != 0:
        raise RuntimeStartError("ADMIN_AUTHORIZATION_REQUIRED")
    contract = validate_contract(contract_path)
    validate_approval_record(approval_record_path, contract)
    version = validate_installed_container()
    start_command = runtime_start_command(contract)
    start = _run(start_command, timeout=300)
    if start.returncode != 0:
        raise RuntimeStartError("RUNTIME_START_FAILED", _command_result_payload(start))
    return {
        "result": "PASS",
        "mode": "execute-start",
        "container_cli_version": version,
        "runtime_start_command": start_command,
        "runtime_start_returncode": start.returncode,
        "runtime_status": runtime_status(),
        "runtime_start_executed": True,
        "workload_started": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "print-approval-command", "print-admin-command", "execute-start"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path)
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
                    "note": "Owner must send this exact command before runtime start.",
                }
            )
            return 0
        if args.mode == "print-admin-command":
            record = str(args.approval_record) if args.approval_record else "docs/program/PHASE_1B_B2_R2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json"
            _json_print(
                {
                    "result": "PASS",
                    "mode": args.mode,
                    "admin_command": " ".join(shlex.quote(part) for part in build_admin_command(record, contract_path=args.contract)),
                    "note": "Run only after committed approval record validation.",
                }
            )
            return 0
        if args.approval_record is None:
            raise RuntimeStartError("APPROVAL_RECORD_REQUIRED")
        _json_print(execute_start(args.contract, args.approval_record))
        return 0
    except (RuntimeStartError, subprocess.TimeoutExpired) as error:
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
