#!/usr/bin/env python3
"""Phase 1B-C9 R2 Lima firewall target discovery runner.

Starts exactly one disposable synthetic Lima VM for firewall target discovery
and records sanitized target information. It never executes pfctl, never mutates
host firewall state, never starts production profiles, and never uses real
credentials.
"""

from __future__ import annotations

import argparse
import datetime as dt
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

from tools.phase_1b_c2_lima_config_validator import validate_config
from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R2_FIREWALL_TARGET_DISCOVERY_CONTRACT.ready.json"
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R2_FIREWALL_TARGET_DISCOVERY_APPROVAL_RECORD.json"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_FIREWALL_TARGET_DISCOVERY"
EXPECTED_SCHEMA = "pankster.phase1b-c9-r2.synthetic-lima-firewall-target-discovery-contract.v1"
EXPECTED_CONTRACT_SHA = "3048d2668b5c224ec98bdb0cb1aca865f6fa5e8070e4432833c1c034db6c8b4d"
EXPECTED_RECORD_SHA = "b440e9aa1def321a932084e64f2c9ac1a2c43bd66cec9c006fc6c8dd521bd5ca"
EXPECTED_NETWORK_DECISION = "ACCEPT_DEFAULT_LIMA_NAT_EGRESS_FOR_SYNTHETIC_TARGET_DISCOVERY_ONLY"

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


class TargetDiscoveryError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _owner_command_hash(approval_id: str, content_sha: str) -> str:
    command = f"{APPROVAL_PREFIX}:{approval_id}:{content_sha}"
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def _record_without_hash(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "record_sha256"}


def _sanitized_env(content: dict) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}
    install_prefix = str(Path(content["limactl_path"]).parent.parent)
    env["PATH"] = f"{install_prefix}/bin:/usr/bin:/bin"
    env["LIMA_HOME"] = content["lima_home"]
    env.setdefault("HOME", "/Users/maksimpankratov")
    env.setdefault("LANG", "C")
    return env


def _run(args: Sequence[str], *, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    if args and Path(args[0]).name == "pfctl":
        raise TargetDiscoveryError("PFCTL_EXECUTION_FORBIDDEN")
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
        raise TargetDiscoveryError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise TargetDiscoveryError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise TargetDiscoveryError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise TargetDiscoveryError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise TargetDiscoveryError("CONTRACT_CONTENT_SHA_MISMATCH")
    if content.get("network_risk_decision") != EXPECTED_NETWORK_DECISION:
        raise TargetDiscoveryError("NETWORK_RISK_DECISION_MISSING")
    if content.get("target_discovery_only") is not True:
        raise TargetDiscoveryError("TARGET_DISCOVERY_ONLY_REQUIRED")
    if content.get("target_guest_ipv4_must_be_recorded_before_c9_r3") is not True:
        raise TargetDiscoveryError("TARGET_IP_RECORD_REQUIRED")
    if content.get("target_vm_reuse_for_production_candidate_allowed") is not False:
        raise TargetDiscoveryError("TARGET_VM_REUSE_UNEXPECTEDLY_ALLOWED")
    for field in (
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "host_sync_allowed",
        "guest_writes_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if content.get(field) is not False:
            raise TargetDiscoveryError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if _now() >= _parse_time(content["expires_at"]):
        raise TargetDiscoveryError("CONTRACT_EXPIRED")
    return content


def _validate_record(record: dict, content: dict) -> None:
    if record.get("record_sha256") != EXPECTED_RECORD_SHA:
        raise TargetDiscoveryError("APPROVAL_RECORD_SHA_UNEXPECTED")
    actual_record_sha = hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest()
    if actual_record_sha != record["record_sha256"]:
        raise TargetDiscoveryError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise TargetDiscoveryError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != content["approval_id"]:
        raise TargetDiscoveryError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise TargetDiscoveryError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA):
        raise TargetDiscoveryError("OWNER_COMMAND_HASH_MISMATCH")
    if record.get("target_discovery_execution_allowed") is not True:
        raise TargetDiscoveryError("TARGET_DISCOVERY_NOT_APPROVED")
    if record.get("new_vm_start_allowed") is not True:
        raise TargetDiscoveryError("NEW_VM_START_NOT_APPROVED")
    for field in (
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "host_sync_allowed",
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
    ):
        if record.get(field) is not False:
            raise TargetDiscoveryError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if record.get("synthetic_only") is not True:
        raise TargetDiscoveryError("SYNTHETIC_ONLY_REQUIRED")
    if _now() >= _parse_time(record["expires_at"]):
        raise TargetDiscoveryError("APPROVAL_RECORD_EXPIRED")


def _validate_paths(content: dict) -> None:
    limactl_path = Path(content["limactl_path"])
    if not limactl_path.is_file() or limactl_path.is_symlink():
        raise TargetDiscoveryError("LIMACTL_PATH_INVALID")
    if _sha256_file(limactl_path) != content["limactl_binary_sha256"]:
        raise TargetDiscoveryError("LIMACTL_SHA_MISMATCH")
    lima_home = Path(content["lima_home"])
    allowed_root = Path("/Users/maksimpankratov/.local/pankster/runtime")
    try:
        lima_home.relative_to(allowed_root)
    except ValueError as error:
        raise TargetDiscoveryError("LIMA_HOME_OUT_OF_SCOPE") from error
    if lima_home == allowed_root or lima_home.is_symlink():
        raise TargetDiscoveryError("LIMA_HOME_UNSAFE")
    config_result = validate_config(PROJECT_ROOT / content["config_path"])
    if config_result["config_sha256"] != content["config_sha256"]:
        raise TargetDiscoveryError("C2_CONFIG_SHA_MISMATCH")


def _validate_no_existing_runtime_state(content: dict) -> None:
    lima_home = Path(content["lima_home"])
    if lima_home.exists():
        raise TargetDiscoveryError("LIMA_HOME_ALREADY_EXISTS", str(lima_home))
    default_lima = Path("/Users/maksimpankratov/.lima")
    if default_lima.exists():
        raise TargetDiscoveryError("DEFAULT_LIMA_HOME_EXISTS")


def load_and_validate(contract_path: Path, approval_record_path: Path, *, require_empty_home: bool) -> tuple[dict, dict]:
    try:
        contract = load_json(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise TargetDiscoveryError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
    content = _validate_contract(contract)
    _validate_record(record, content)
    _validate_paths(content)
    if require_empty_home:
        _validate_no_existing_runtime_state(content)
    return content, record


def preflight(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path, require_empty_home=True)
    return {
        "result": "PASS",
        "mode": "preflight",
        "approval_id": content["approval_id"],
        "target_instance": content["instance_name"],
        "target_lima_home": content["lima_home"],
        "network_risk_decision": content["network_risk_decision"],
        "target_discovery_executed": False,
        "new_vm_start_allowed": True,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
        "gateway_changes_allowed": False,
    }


def _stdout_lines(stdout: str) -> list[str]:
    return [line for line in stdout.splitlines() if line.strip()]


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


def _extract_guest_ipv4(addr_lines: list[str]) -> dict:
    for line in addr_lines:
        match = re.search(r"\binet\s+([0-9]+(?:\.[0-9]+){3})/([0-9]{1,2})\b", line)
        if match:
            return {"ipv4": match.group(1), "prefix": int(match.group(2)), "source": "ip -4 addr show dev eth0"}
    raise TargetDiscoveryError("GUEST_IPV4_NOT_FOUND")


def _classify_marker(lines: list[str], available_marker: str, unavailable_marker: str) -> str:
    if available_marker in lines:
        return "AVAILABLE"
    if unavailable_marker in lines:
        return "UNAVAILABLE"
    return "UNKNOWN"


def execute_discovery(contract_path: Path, approval_record_path: Path) -> dict:
    content, _record = load_and_validate(contract_path, approval_record_path, require_empty_home=True)
    env = _sanitized_env(content)
    config_path = PROJECT_ROOT / content["config_path"]
    start = _run(
        [
            content["limactl_path"],
            "start",
            "--tty=false",
            "--name",
            content["instance_name"],
            "--timeout",
            "20m",
            str(config_path),
        ],
        env=env,
        timeout=1500,
    )
    if start.returncode != 0:
        raise TargetDiscoveryError("TARGET_VM_START_FAILED", f"rc={start.returncode}")
    commands = {
        "list": [content["limactl_path"], "list", "--format", "json", content["instance_name"]],
        "addr": [content["limactl_path"], "shell", "--tty=false", content["instance_name"], "--", "/bin/sh", "-lc", "ip -4 addr show dev eth0"],
        "route": [content["limactl_path"], "shell", "--tty=false", content["instance_name"], "--", "/bin/sh", "-lc", "ip route"],
        "dns": [
            content["limactl_path"],
            "shell",
            "--tty=false",
            content["instance_name"],
            "--",
            "/bin/sh",
            "-lc",
            "timeout 5 getent hosts example.com >/dev/null && echo dns_example_com_available || echo dns_example_com_unavailable",
        ],
        "tcp": [
            content["limactl_path"],
            "shell",
            "--tty=false",
            content["instance_name"],
            "--",
            "/bin/sh",
            "-lc",
            "command -v bash >/dev/null && timeout 5 bash -lc ': >/dev/tcp/1.1.1.1/443' >/dev/null 2>&1 && echo tcp_1_1_1_1_443_open || echo tcp_1_1_1_1_443_closed_or_unavailable",
        ],
    }
    raw: dict[str, subprocess.CompletedProcess[str]] = {}
    for name, argv in commands.items():
        completed = _run(argv, env=env, timeout=90)
        if completed.returncode != 0:
            raise TargetDiscoveryError("DISCOVERY_COMMAND_FAILED", f"{name};rc={completed.returncode}")
        raw[name] = completed
    addr_lines = _stdout_lines(raw["addr"].stdout)
    route_lines = _stdout_lines(raw["route"].stdout)
    dns_lines = _stdout_lines(raw["dns"].stdout)
    tcp_lines = _stdout_lines(raw["tcp"].stdout)
    return {
        "result": "PASS",
        "mode": "execute-discovery",
        "approval_id": content["approval_id"],
        "target_instance": content["instance_name"],
        "target_lima_home": content["lima_home"],
        "target_discovery_executed": True,
        "target_vm_started": True,
        "pfctl_execution_allowed": False,
        "pfctl_executed": False,
        "host_firewall_changes_allowed": False,
        "host_firewall_changes_performed": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
        "gateway_changes_allowed": False,
        "canary_allowed": False,
        "host_status": _summarize_list(raw["list"].stdout),
        "guest_ipv4": _extract_guest_ipv4(addr_lines),
        "guest_addr_stdout_lines": addr_lines,
        "guest_route_stdout_lines": route_lines,
        "before_firewall_network_classification": {
            "dns_example_com": _classify_marker(dns_lines, "dns_example_com_available", "dns_example_com_unavailable"),
            "tcp_1_1_1_1_443": _classify_marker(tcp_lines, "tcp_1_1_1_1_443_open", "tcp_1_1_1_1_443_closed_or_unavailable"),
        },
        "next_gate_after_success": content["next_gate_after_success"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "execute-discovery"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.contract, args.approval_record))
            return 0
        if args.mode == "execute-discovery":
            _json_print(execute_discovery(args.contract, args.approval_record))
            return 0
    except (TargetDiscoveryError, ManifestError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
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
