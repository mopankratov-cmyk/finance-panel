#!/usr/bin/env python3
"""Phase 1B-C5 synthetic Lima egress classification runner.

Runs only the exact bounded network-classification probes approved in the C5
contract. It never sends HTTP payloads, never uses --preserve-env, never syncs
host directories, never writes in the guest, and records sanitized evidence
only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C5_SYNTHETIC_LIMA_EGRESS_CLASSIFICATION_CONTRACT.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C5_SYNTHETIC_LIMA_EGRESS_CLASSIFICATION_APPROVAL_RECORD.json"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_EGRESS_CLASSIFICATION"
EXPECTED_SCHEMA = "pankster.phase1b-c5.synthetic-lima-egress-classification-contract.v1"
EXPECTED_CONTRACT_SHA = "7172db2bdc66461dfa5f0e2c49fd9134833889fffa53a80f546b239da38f7d1d"
EXPECTED_RECORD_SHA = "71892ab88dc02cc4be3a452cb01be22dada3bda57084f62fc6e0a543f66967cb"

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
    "http://",
    "https://",
)


class EgressRunnerError(RuntimeError):
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
        raise EgressRunnerError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise EgressRunnerError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise EgressRunnerError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise EgressRunnerError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise EgressRunnerError("CONTRACT_CONTENT_SHA_MISMATCH")
    if content.get("network_probes_allowed") is not True:
        raise EgressRunnerError("NETWORK_PROBES_NOT_APPROVED")
    for field in (
        "preserve_host_env_allowed",
        "guest_writes_allowed",
        "host_sync_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if content.get(field) is not False:
            raise EgressRunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if _now() >= _parse_time(content["expires_at"]):
        raise EgressRunnerError("CONTRACT_EXPIRED")
    limactl_path = Path(content["limactl_path"])
    if not limactl_path.is_file() or limactl_path.is_symlink():
        raise EgressRunnerError("LIMACTL_PATH_INVALID")
    if _sha256_file(limactl_path) != content["limactl_binary_sha256"]:
        raise EgressRunnerError("LIMACTL_SHA_MISMATCH")
    c4_path = PROJECT_ROOT / content["c4_execution_evidence"]
    if not c4_path.is_file() or c4_path.is_symlink():
        raise EgressRunnerError("C4_EVIDENCE_MISSING")
    if hashlib.sha256(c4_path.read_bytes()).hexdigest() != content["c4_execution_evidence_sha256"]:
        raise EgressRunnerError("C4_EVIDENCE_SHA_MISMATCH")
    endpoints = content.get("network_probe_endpoints")
    if endpoints != ["example.com DNS lookup", "1.1.1.1:443 TCP connect"]:
        raise EgressRunnerError("NETWORK_ENDPOINTS_UNEXPECTED")
    return content


def _validate_record(record: dict, content: dict) -> None:
    if record.get("record_sha256") != EXPECTED_RECORD_SHA:
        raise EgressRunnerError("APPROVAL_RECORD_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest() != EXPECTED_RECORD_SHA:
        raise EgressRunnerError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise EgressRunnerError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != content["approval_id"]:
        raise EgressRunnerError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise EgressRunnerError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA):
        raise EgressRunnerError("OWNER_COMMAND_HASH_MISMATCH")
    if record.get("network_probes_allowed") is not True:
        raise EgressRunnerError("NETWORK_PROBES_NOT_APPROVED")
    if record.get("http_payloads_allowed") is not False:
        raise EgressRunnerError("HTTP_PAYLOADS_UNEXPECTEDLY_ALLOWED")
    for field in (
        "preserve_host_env_allowed",
        "guest_writes_allowed",
        "host_sync_allowed",
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if record.get(field) is not False:
            raise EgressRunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if record.get("synthetic_only") is not True:
        raise EgressRunnerError("SYNTHETIC_ONLY_REQUIRED")
    if _now() >= _parse_time(record["expires_at"]):
        raise EgressRunnerError("APPROVAL_RECORD_EXPIRED")


def _materialize_command(content: dict, argv: list[str]) -> list[str]:
    if not argv or argv[0] != "limactl":
        raise EgressRunnerError("PROBE_ARGV_NOT_LIMACTL")
    for arg in argv:
        lowered = arg.lower()
        if any(fragment in lowered for fragment in FORBIDDEN_ARG_FRAGMENTS):
            raise EgressRunnerError("FORBIDDEN_PROBE_ARGUMENT", arg)
    return [content["limactl_path"], *argv[1:]]


def _approved_commands(content: dict) -> list[list[str]]:
    commands = []
    for item in content["allowed_probe_commands"]:
        argv = item.get("argv")
        if not isinstance(argv, list) or not all(isinstance(part, str) for part in argv):
            raise EgressRunnerError("PROBE_ARGV_INVALID")
        commands.append(argv)
    if len(commands) != 4:
        raise EgressRunnerError("PROBE_COUNT_UNEXPECTED")
    return commands


def load_and_validate(contract_path: Path, approval_record_path: Path) -> tuple[dict, dict]:
    try:
        contract = load_json(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise EgressRunnerError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
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
        "network_probes_allowed": True,
        "http_payloads_allowed": False,
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


def _classify_marker(lines: list[str], available_marker: str, unavailable_marker: str) -> str:
    if available_marker in lines:
        return "AVAILABLE"
    if unavailable_marker in lines:
        return "UNAVAILABLE"
    return "UNKNOWN"


def execute_probes(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path)
    env = _sanitized_env(content)
    results = []
    dns_result = "UNKNOWN"
    tcp_result = "UNKNOWN"
    for index, item in enumerate(content["allowed_probe_commands"]):
        argv = item["argv"]
        command = _materialize_command(content, argv)
        completed = _run(command, env=env, timeout=15)
        if completed.returncode != 0:
            raise EgressRunnerError("PROBE_FAILED", f"index={index};rc={completed.returncode}")
        stdout_lines = _stdout_lines(completed.stdout)
        stderr_lines = _stdout_lines(completed.stderr)
        if index == 0:
            summary = _summarize_list(completed.stdout)
        else:
            summary = {"stdout_lines": stdout_lines, "stderr_lines": stderr_lines}
        if index == 2:
            dns_result = _classify_marker(stdout_lines, "dns_example_com_available", "dns_example_com_unavailable")
        if index == 3:
            tcp_result = _classify_marker(
                stdout_lines,
                "tcp_1_1_1_1_443_open",
                "tcp_1_1_1_1_443_closed_or_unavailable",
            )
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
        "network_probes_allowed": True,
        "http_payloads_allowed": False,
        "preserve_host_env_allowed": False,
        "guest_writes_allowed": False,
        "host_sync_allowed": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
        "gateway_changes_allowed": False,
        "canary_allowed": False,
        "dns_result": dns_result,
        "tcp_443_result": tcp_result,
        "egress_observed": dns_result == "AVAILABLE" or tcp_result == "AVAILABLE",
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
    except (EgressRunnerError, ManifestError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
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
