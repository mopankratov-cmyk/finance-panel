#!/usr/bin/env python3
"""Phase 1B-C4 synthetic Lima post-start probe runner.

Runs only the exact read-only non-network probes approved in the C4 contract.
It never uses --preserve-env, never syncs host directories, and records
sanitized evidence only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C4_SYNTHETIC_LIMA_POSTSTART_PROBE_CONTRACT.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C4_SYNTHETIC_LIMA_POSTSTART_PROBE_APPROVAL_RECORD.json"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_POSTSTART_PROBE"
EXPECTED_SCHEMA = "pankster.phase1b-c4.synthetic-poststart-probe-contract.v1"
EXPECTED_CONTRACT_SHA = "32f674f863d88570c1ee55f49ac85cca2cd2779bcdd992f3f248813048a2f92a"
EXPECTED_RECORD_SHA = "8056ee6818ad558eb82aeab385644b45f9f819ae3cc51993d2098e739695bbde"

FORBIDDEN_ARG_FRAGMENTS = (
    "curl",
    "wget",
    "apt",
    "apk",
    "dnf",
    "yum",
    "brew",
    "--preserve-env",
    "--sync",
)


class ProbeRunnerError(RuntimeError):
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


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _owner_command_hash(approval_id: str, content_sha: str) -> str:
    command = f"{APPROVAL_PREFIX}:{approval_id}:{content_sha}"
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def _record_without_hash(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "record_sha256"}


def _sanitized_env(content: dict) -> dict[str, str]:
    install_prefix = str(Path(content["limactl_path"]).parent.parent)
    return {
        "PATH": f"{install_prefix}/bin:/usr/bin:/bin",
        "HOME": "/Users/maksimpankratov",
        "LANG": "C",
        "LIMA_HOME": content["lima_home"],
    }


def _run(args: Sequence[str], *, env: dict[str, str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        check=False,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def _validate_contract(contract: dict) -> dict:
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise ProbeRunnerError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise ProbeRunnerError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise ProbeRunnerError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise ProbeRunnerError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise ProbeRunnerError("CONTRACT_CONTENT_SHA_MISMATCH")
    for field in (
        "network_probes_allowed",
        "preserve_host_env_allowed",
        "guest_writes_allowed",
        "host_sync_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if content.get(field) is not False:
            raise ProbeRunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if _now() >= _parse_time(content["expires_at"]):
        raise ProbeRunnerError("CONTRACT_EXPIRED")
    limactl_path = Path(content["limactl_path"])
    if not limactl_path.is_file() or limactl_path.is_symlink():
        raise ProbeRunnerError("LIMACTL_PATH_INVALID")
    if _sha256_file(limactl_path) != content["limactl_binary_sha256"]:
        raise ProbeRunnerError("LIMACTL_SHA_MISMATCH")
    c3_path = PROJECT_ROOT / content["c3_execution_evidence"]
    if not c3_path.is_file() or c3_path.is_symlink():
        raise ProbeRunnerError("C3_EVIDENCE_MISSING")
    if hashlib.sha256(c3_path.read_bytes()).hexdigest() != content["c3_execution_evidence_sha256"]:
        raise ProbeRunnerError("C3_EVIDENCE_SHA_MISMATCH")
    return content


def _validate_record(record: dict, content: dict) -> None:
    if record.get("record_sha256") != EXPECTED_RECORD_SHA:
        raise ProbeRunnerError("APPROVAL_RECORD_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest() != EXPECTED_RECORD_SHA:
        raise ProbeRunnerError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise ProbeRunnerError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != content["approval_id"]:
        raise ProbeRunnerError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise ProbeRunnerError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA):
        raise ProbeRunnerError("OWNER_COMMAND_HASH_MISMATCH")
    for field in (
        "network_probes_allowed",
        "preserve_host_env_allowed",
        "guest_writes_allowed",
        "host_sync_allowed",
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if record.get(field) is not False:
            raise ProbeRunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if record.get("synthetic_only") is not True:
        raise ProbeRunnerError("SYNTHETIC_ONLY_REQUIRED")
    if _now() >= _parse_time(record["expires_at"]):
        raise ProbeRunnerError("APPROVAL_RECORD_EXPIRED")


def _materialize_command(content: dict, argv: list[str]) -> list[str]:
    if not argv or argv[0] != "limactl":
        raise ProbeRunnerError("PROBE_ARGV_NOT_LIMACTL")
    for arg in argv:
        lowered = arg.lower()
        if any(fragment in lowered for fragment in FORBIDDEN_ARG_FRAGMENTS):
            raise ProbeRunnerError("FORBIDDEN_PROBE_ARGUMENT", arg)
    return [content["limactl_path"], *argv[1:]]


def _approved_commands(content: dict) -> list[list[str]]:
    commands = []
    for item in content["allowed_probe_commands"]:
        argv = item.get("argv")
        if not isinstance(argv, list) or not all(isinstance(part, str) for part in argv):
            raise ProbeRunnerError("PROBE_ARGV_INVALID")
        commands.append(argv)
    return commands


def load_and_validate(contract_path: Path, approval_record_path: Path) -> tuple[dict, dict]:
    try:
        contract = load_json(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise ProbeRunnerError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
    content = _validate_contract(contract)
    _validate_record(record, content)
    _approved_commands(content)
    return content, record


def preflight(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path)
    return {
        "result": "PASS",
        "mode": "preflight",
        "approval_id": content["approval_id"],
        "instance_name": content["instance_name"],
        "probe_count": len(content["allowed_probe_commands"]),
        "network_probes_allowed": False,
        "preserve_host_env_allowed": False,
        "guest_writes_allowed": False,
        "host_sync_allowed": False,
        "probes_executed": False,
    }


def _summarize_list(raw: str) -> dict:
    parsed = json.loads(raw)
    item = parsed[0] if isinstance(parsed, list) else parsed
    config = item.get("config", {})
    return {
        "name": item.get("name"),
        "status": item.get("status"),
        "vmType": item.get("vmType"),
        "arch": item.get("arch"),
        "limaHome": item.get("LimaHome"),
        "limaVersion": item.get("limaVersion"),
        "hostAgentPID": item.get("hostAgentPID"),
        "driverPID": item.get("driverPID"),
        "sshAddress": item.get("sshAddress"),
        "sshLocalPort": item.get("sshLocalPort"),
        "config_mounts": config.get("mounts", []),
        "containerd_system": config.get("containerd", {}).get("system"),
        "containerd_user": config.get("containerd", {}).get("user"),
        "propagateProxyEnv": config.get("propagateProxyEnv"),
        "hostResolver_enabled": config.get("hostResolver", {}).get("enabled"),
        "portForwards": config.get("portForwards", []),
        "networks": config.get("networks", []),
    }


def _stdout_lines(stdout: str) -> list[str]:
    return [line for line in stdout.splitlines() if line.strip()]


def execute_probes(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path)
    env = _sanitized_env(content)
    results = []
    for index, item in enumerate(content["allowed_probe_commands"]):
        argv = item["argv"]
        command = _materialize_command(content, argv)
        completed = _run(command, env=env, timeout=90)
        if completed.returncode != 0:
            raise ProbeRunnerError("PROBE_FAILED", f"index={index};rc={completed.returncode}")
        if index == 0:
            summary = _summarize_list(completed.stdout)
        else:
            summary = {"stdout_lines": _stdout_lines(completed.stdout), "stderr_lines": _stdout_lines(completed.stderr)}
        results.append(
            {
                "index": index,
                "scope": item["scope"],
                "purpose": item["purpose"],
                "returncode": completed.returncode,
                "summary": summary,
            }
        )
    return {
        "result": "PASS",
        "mode": "execute-probes",
        "approval_id": content["approval_id"],
        "instance_name": content["instance_name"],
        "probe_count": len(results),
        "network_probes_allowed": False,
        "preserve_host_env_allowed": False,
        "guest_writes_allowed": False,
        "host_sync_allowed": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
        "gateway_changes_allowed": False,
        "canary_allowed": False,
        "probes": results,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "execute-probes"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.contract, args.approval_record))
            return 0
        if args.mode == "execute-probes":
            _json_print(execute_probes(args.contract, args.approval_record))
            return 0
    except (ProbeRunnerError, ManifestError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
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
