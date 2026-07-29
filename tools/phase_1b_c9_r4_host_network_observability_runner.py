#!/usr/bin/env python3
"""Phase 1B-C9 R4 host network observability discovery runner.

Executes only the owner-approved non-mutating host network metadata commands.
It never executes pfctl, never captures packets, never generates guest traffic,
never mutates firewall/runtime state, and never reads credentials.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import ipaddress
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

from tools.phase_1b_c9_r4_host_network_observability_validator import (
    APPROVAL_PREFIX,
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_TOOL_ALLOWLIST,
    EXPECTED_TOOL_DENYLIST,
    validate_contract,
)
from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R4_HOST_NETWORK_OBSERVABILITY_DISCOVERY_APPROVAL_RECORD.json"
EXPECTED_RECORD_SHA = "ccc92e592dbecae4cc990a60fd6b9c768e3d475ca1e1529cdb61a6abf65acc0b"
TARGET_GUEST_IPV4 = "192.168.5.15"
TARGET_SUBNET_PREFIX = "192.168.5."
SANITIZED_ENV_KEYS = {"LANG", "LC_ALL", "LC_CTYPE", "PATH", "TMPDIR"}


class C9R4RunnerError(RuntimeError):
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


def _validate_record(record: dict) -> None:
    if record.get("record_sha256") != EXPECTED_RECORD_SHA:
        raise C9R4RunnerError("APPROVAL_RECORD_SHA_UNEXPECTED")
    actual_record_sha = hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest()
    if actual_record_sha != record["record_sha256"]:
        raise C9R4RunnerError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise C9R4RunnerError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != "p1b-20260722-limaobsc9r4":
        raise C9R4RunnerError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R4RunnerError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(record["approval_id"], EXPECTED_CONTRACT_SHA):
        raise C9R4RunnerError("OWNER_COMMAND_HASH_MISMATCH")
    if record.get("host_network_observability_execution_allowed") is not True:
        raise C9R4RunnerError("HOST_NETWORK_OBSERVABILITY_NOT_APPROVED")
    if record.get("tool_allowlist") != EXPECTED_TOOL_ALLOWLIST:
        raise C9R4RunnerError("APPROVAL_TOOL_ALLOWLIST_UNEXPECTED")
    if _now() >= _parse_time(record["expires_at"]):
        raise C9R4RunnerError("APPROVAL_RECORD_EXPIRED")
    for field in (
        "pfctl_execution_allowed",
        "packet_capture_allowed",
        "guest_traffic_generation_allowed",
        "host_firewall_changes_allowed",
        "pf_config_edits_allowed",
        "host_sync_allowed",
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "reclaim_delete_allowed",
    ):
        if record.get(field) is not False:
            raise C9R4RunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if record.get("synthetic_only") is not True:
        raise C9R4RunnerError("SYNTHETIC_ONLY_REQUIRED")


def load_and_validate(contract_path: Path, approval_record_path: Path) -> tuple[dict, dict]:
    try:
        contract_result = validate_contract(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise C9R4RunnerError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
    _validate_record(record)
    return contract_result, record


def preflight(contract_path: Path, approval_record_path: Path) -> dict:
    contract_result, record = load_and_validate(contract_path, approval_record_path)
    return {
        "result": "PASS",
        "mode": "preflight",
        "approval_id": record["approval_id"],
        "target_instance": contract_result["target_instance"],
        "target_guest_ipv4": contract_result["target_guest_ipv4"],
        "host_network_observability_executed": False,
        "tool_allowlist": EXPECTED_TOOL_ALLOWLIST,
        "tool_denylist": EXPECTED_TOOL_DENYLIST,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "packet_capture_allowed": False,
        "guest_traffic_generation_allowed": False,
        "real_credentials_allowed": False,
        "production_profiles_allowed": False,
    }


def _sanitized_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in SANITIZED_ENV_KEYS}
    env["PATH"] = "/usr/sbin:/sbin:/usr/bin:/bin"
    env.setdefault("LANG", "C")
    return env


def _run_allowed(path: str, args: Sequence[str], *, timeout: int = 10) -> subprocess.CompletedProcess[str]:
    if path not in EXPECTED_TOOL_ALLOWLIST:
        raise C9R4RunnerError("COMMAND_NOT_ALLOWLISTED", path)
    if path in EXPECTED_TOOL_DENYLIST or Path(path).name in {"pfctl", "tcpdump", "sudo"}:
        raise C9R4RunnerError("DENIED_COMMAND_REQUESTED", path)
    return subprocess.run(
        [path, *args],
        check=False,
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def _assert_success(name: str, result: subprocess.CompletedProcess[str]) -> str:
    if result.returncode != 0:
        detail = f"{name}: rc={result.returncode}"
        raise C9R4RunnerError("HOST_OBSERVABILITY_COMMAND_FAILED", detail)
    return result.stdout


def _ip_scope(value: str) -> str:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return "invalid"
    if ip.is_loopback:
        return "loopback"
    if ip.is_link_local:
        return "link_local"
    if ip.is_private:
        return "private"
    return "public"


def _summarize_ifconfig(raw: str) -> dict:
    interfaces: list[dict] = []
    current: dict | None = None
    for line in raw.splitlines():
        header = re.match(r"^([A-Za-z0-9_.:-]+):\s+flags=.*\bmtu\s+(\d+)", line)
        if header:
            current = {
                "name": header.group(1),
                "mtu": int(header.group(2)),
                "status": "unknown",
                "ipv4_scopes": [],
                "ipv4_count": 0,
            }
            interfaces.append(current)
            continue
        if current is None:
            continue
        stripped = line.strip()
        if stripped.startswith("status:"):
            current["status"] = stripped.split(":", 1)[1].strip()
        inet_match = re.match(r"inet\s+([0-9.]+)\b", stripped)
        if inet_match:
            scope = _ip_scope(inet_match.group(1))
            if scope not in current["ipv4_scopes"]:
                current["ipv4_scopes"].append(scope)
            current["ipv4_count"] += 1
    return {
        "interface_count": len(interfaces),
        "interfaces": interfaces,
        "raw_output_persisted": False,
    }


def _summarize_netstat(raw: str) -> dict:
    default_routes = 0
    target_subnet_routes: list[dict] = []
    route_interfaces: set[str] = set()
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        destination = parts[0]
        if destination in {"Destination", "Internet:"}:
            continue
        if destination == "default":
            default_routes += 1
        netif = parts[3]
        if re.match(r"^[A-Za-z0-9_.:-]+$", netif):
            route_interfaces.add(netif)
        if destination == "192.168.5" or destination.startswith(TARGET_SUBNET_PREFIX):
            target_subnet_routes.append(
                {
                    "destination": destination,
                    "gateway_scope": _ip_scope(parts[1]),
                    "flags": parts[2],
                    "netif": netif,
                }
            )
    return {
        "default_routes_count": default_routes,
        "route_interface_count": len(route_interfaces),
        "route_interfaces": sorted(route_interfaces),
        "target_subnet_routes": target_subnet_routes,
        "raw_output_persisted": False,
    }


def _summarize_route_get(raw: str) -> dict:
    fields: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
    gateway = fields.get("gateway")
    interface = fields.get("interface")
    source = fields.get("source")
    return {
        "target": TARGET_GUEST_IPV4,
        "route_interface": interface,
        "gateway_scope": _ip_scope(gateway) if gateway else "absent",
        "source_scope": _ip_scope(source) if source else "absent",
        "has_interface": bool(interface),
        "raw_output_persisted": False,
    }


def execute_discovery(contract_path: Path, approval_record_path: Path) -> dict:
    contract_result, record = load_and_validate(contract_path, approval_record_path)
    ifconfig_raw = _assert_success("ifconfig", _run_allowed("/sbin/ifconfig", ["-a"]))
    netstat_raw = _assert_success("netstat", _run_allowed("/usr/sbin/netstat", ["-rn", "-f", "inet"]))
    route_raw = _assert_success("route", _run_allowed("/sbin/route", ["-n", "get", TARGET_GUEST_IPV4]))
    ifconfig_summary = _summarize_ifconfig(ifconfig_raw)
    netstat_summary = _summarize_netstat(netstat_raw)
    route_summary = _summarize_route_get(route_raw)
    route_interface = route_summary["route_interface"]
    subnet_route_interfaces = {entry["netif"] for entry in netstat_summary["target_subnet_routes"]}
    single_interface_candidate = bool(route_interface) and (
        not subnet_route_interfaces or subnet_route_interfaces == {route_interface}
    )
    return {
        "result": "PASS",
        "mode": "execute-discovery",
        "approval": {
            "approval_id": record["approval_id"],
            "approval_record_path": str(approval_record_path.relative_to(PROJECT_ROOT)),
            "approval_record_file_sha256": _sha256_file(approval_record_path),
            "approval_record_canonical_sha256": record["record_sha256"],
            "contract_path": str(contract_path.relative_to(PROJECT_ROOT)),
            "contract_file_sha256": _sha256_file(contract_path),
            "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        },
        "hard_gates": {
            "pfctl_execution_allowed": False,
            "pfctl_executed": False,
            "host_firewall_changes_allowed": False,
            "host_firewall_changes_performed": False,
            "packet_capture_allowed": False,
            "packet_capture_performed": False,
            "guest_traffic_generation_allowed": False,
            "guest_traffic_generated": False,
            "production_profiles_allowed": False,
            "real_credentials_allowed": False,
            "gateway_changes_allowed": False,
            "canary_allowed": False,
            "reclaim_delete_allowed": False,
        },
        "target": {
            "instance_name": contract_result["target_instance"],
            "guest_ipv4": contract_result["target_guest_ipv4"],
        },
        "host_observability": {
            "ifconfig": ifconfig_summary,
            "netstat_inet": netstat_summary,
            "route_get_target": route_summary,
        },
        "c9_r5_implications": {
            "single_host_interface_candidate": single_interface_candidate,
            "candidate_interface": route_interface,
            "pf_visibility_proven": False,
            "target_uniqueness_proven": False,
            "packet_visibility_probe_contract_ready": bool(route_interface),
            "reason": "Host route metadata can identify an observation candidate, but it cannot prove pf pre-NAT visibility or target uniqueness without a separate owner-approved packet-visibility probe."
        },
        "raw_command_outputs_persisted": False,
        "next_gate": "PHASE_1B_C9_R5_PACKET_VISIBILITY_PROBE_CONTRACT_OR_FAIL_CLOSED",
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
    except (C9R4RunnerError, ManifestError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
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
