#!/usr/bin/env python3
"""Phase 1B-C9 R5 packet visibility probe runner.

Runs only the owner-approved scoped packet visibility probe. It never executes
pfctl, never mutates host firewall state, never persists raw packet output, and
never uses production runtime state or credentials.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.phase_1b_c9_r5_packet_visibility_validator import (
    APPROVAL_PREFIX,
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    validate_contract,
)
from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R5_PACKET_VISIBILITY_PROBE_APPROVAL_RECORD.json"
EXPECTED_RECORD_SHA = "30c0b6e5c4998c1b5c237b12ecc8ba3bf545c3c6aa53bc0b1b8e2c97273a27c6"
TARGET_GUEST_IPV4 = "192.168.5.15"
TARGET_CONNECT_HOST = "1.1.1.1"
TARGET_CONNECT_PORT = 443
CAPTURE_INTERFACE = "utun4"
CAPTURE_FILTER = "host 192.168.5.15 and tcp and port 443"
TCPDUMP_PATH = "/usr/sbin/tcpdump"
LIMACTL_PATH = "/Users/maksimpankratov/.local/pankster/isolation-backends/lima-vz/2.2.0/bin/limactl"
SANITIZED_ENV_KEYS = {"LANG", "LC_ALL", "LC_CTYPE", "PATH", "TMPDIR"}


class C9R5RunnerError(RuntimeError):
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
        raise C9R5RunnerError("APPROVAL_RECORD_SHA_UNEXPECTED")
    actual_record_sha = hashlib.sha256(canonical_json_bytes(_record_without_hash(record))).hexdigest()
    if actual_record_sha != record["record_sha256"]:
        raise C9R5RunnerError("APPROVAL_RECORD_SHA_MISMATCH")
    if record.get("decision") != "APPROVED":
        raise C9R5RunnerError("APPROVAL_DECISION_NOT_APPROVED")
    if record.get("approval_id") != "p1b-20260722-limapktc9r5":
        raise C9R5RunnerError("APPROVAL_ID_MISMATCH")
    if record.get("contract_content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R5RunnerError("APPROVAL_CONTRACT_SHA_MISMATCH")
    if record.get("owner_command_hash") != _owner_command_hash(record["approval_id"], EXPECTED_CONTRACT_SHA):
        raise C9R5RunnerError("OWNER_COMMAND_HASH_MISMATCH")
    if _now() >= _parse_time(record["expires_at"]):
        raise C9R5RunnerError("APPROVAL_RECORD_EXPIRED")
    expected_true = (
        "packet_visibility_probe_allowed",
        "packet_capture_allowed",
        "guest_traffic_generation_allowed",
        "print_admin_command_allowed",
        "synthetic_only",
    )
    for field in expected_true:
        if record.get(field) is not True:
            raise C9R5RunnerError(f"{field.upper()}_NOT_APPROVED")
    expected_false = (
        "automatic_privileged_execution_allowed",
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "pf_config_edits_allowed",
        "packet_capture_payload_persistence_allowed",
        "packet_capture_raw_output_persistence_allowed",
        "guest_payload_capture_allowed",
        "guest_dns_query_allowed",
        "host_sync_allowed",
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "reclaim_delete_allowed",
    )
    for field in expected_false:
        if record.get(field) is not False:
            raise C9R5RunnerError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if record.get("packet_capture_interface") != CAPTURE_INTERFACE:
        raise C9R5RunnerError("CAPTURE_INTERFACE_UNEXPECTED")
    if record.get("packet_capture_filter") != CAPTURE_FILTER:
        raise C9R5RunnerError("CAPTURE_FILTER_UNEXPECTED")
    if record.get("packet_capture_max_packets") != 8:
        raise C9R5RunnerError("CAPTURE_PACKET_COUNT_UNEXPECTED")
    if record.get("packet_capture_max_seconds") != 12:
        raise C9R5RunnerError("CAPTURE_TIMEOUT_UNEXPECTED")


def load_and_validate(contract_path: Path, approval_record_path: Path) -> tuple[dict, dict]:
    try:
        contract_result = validate_contract(contract_path)
        record = load_json(approval_record_path)
    except ManifestError as error:
        raise C9R5RunnerError("CONTRACT_OR_APPROVAL_INVALID", str(error)) from error
    _validate_record(record)
    if not Path(TCPDUMP_PATH).is_file():
        raise C9R5RunnerError("TCPDUMP_PATH_MISSING")
    if not Path(LIMACTL_PATH).is_file():
        raise C9R5RunnerError("LIMACTL_PATH_MISSING")
    return contract_result, record


def _sanitized_env() -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if key in SANITIZED_ENV_KEYS}
    env["PATH"] = "/usr/sbin:/sbin:/usr/bin:/bin"
    env.setdefault("LANG", "C")
    env["LIMA_HOME"] = "/Users/maksimpankratov/.local/pankster/runtime/lc9r2"
    return env


def preflight(contract_path: Path, approval_record_path: Path) -> dict:
    contract_result, record = load_and_validate(contract_path, approval_record_path)
    return {
        "result": "PASS",
        "mode": "preflight",
        "approval_id": record["approval_id"],
        "target_instance": contract_result["target_instance"],
        "target_guest_ipv4": contract_result["target_guest_ipv4"],
        "candidate_host_interface": contract_result["candidate_host_interface"],
        "packet_visibility_probe_executed": False,
        "packet_capture_filter": CAPTURE_FILTER,
        "packet_capture_max_packets": 8,
        "packet_capture_max_seconds": 12,
        "automatic_privileged_execution_allowed": False,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "raw_packet_output_persistence_allowed": False,
    }


def print_admin_command(contract_path: Path, approval_record_path: Path) -> dict:
    contract_result, record = load_and_validate(contract_path, approval_record_path)
    command = (
        f"sudo {TCPDUMP_PATH} -n -tt -q -i {CAPTURE_INTERFACE} -c 8 "
        f"'{CAPTURE_FILTER}'"
    )
    return {
        "result": "PASS",
        "mode": "print-admin-command",
        "approval_id": record["approval_id"],
        "target_instance": contract_result["target_instance"],
        "target_guest_ipv4": contract_result["target_guest_ipv4"],
        "candidate_host_interface": CAPTURE_INTERFACE,
        "admin_command": command,
        "note": "Run only if owner approves manual admin packet visibility probing; do not persist raw packet output.",
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
    }


def _tcpdump_args() -> list[str]:
    return [
        TCPDUMP_PATH,
        "-n",
        "-tt",
        "-q",
        "-i",
        CAPTURE_INTERFACE,
        "-c",
        "8",
        CAPTURE_FILTER,
    ]


def _guest_connect_args() -> list[str]:
    guest_script = (
        "timeout 5 bash -lc "
        "'exec 3<>/dev/tcp/1.1.1.1/443; exec 3>&-; exec 3<&-'"
    )
    return [
        LIMACTL_PATH,
        "shell",
        "--tty=false",
        "pc9r2",
        "--",
        "/bin/sh",
        "-lc",
        guest_script,
    ]


def _parse_tcpdump_summary(raw: str) -> dict:
    source_target = 0
    destination_target = 0
    target_visible = False
    observed_lines = 0
    for line in raw.splitlines():
        if TARGET_GUEST_IPV4 not in line:
            continue
        observed_lines += 1
        target_visible = True
        if re.search(rf"\b{re.escape(TARGET_GUEST_IPV4)}\.\d+\s+>", line):
            source_target += 1
        if re.search(rf">\s+{re.escape(TARGET_GUEST_IPV4)}\.\d+:", line):
            destination_target += 1
    return {
        "raw_output_persisted": False,
        "matching_packet_lines": observed_lines,
        "target_ipv4_observed": target_visible,
        "source_target_packet_count": source_target,
        "destination_target_packet_count": destination_target,
        "pre_nat_guest_source_observed": source_target > 0,
        "post_nat_only_observed": observed_lines > 0 and source_target == 0,
    }


def _safe_terminate(process: subprocess.Popen[str]) -> tuple[str, str, bool]:
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=12)
    except subprocess.TimeoutExpired:
        timed_out = True
        process.send_signal(signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=2)
    return stdout, stderr, timed_out


def execute_probe(contract_path: Path, approval_record_path: Path) -> dict:
    contract_result, record = load_and_validate(contract_path, approval_record_path)
    tcpdump = subprocess.Popen(
        _tcpdump_args(),
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    time.sleep(1.0)
    if tcpdump.poll() is not None:
        _stdout, stderr = tcpdump.communicate(timeout=2)
        if "permission" in stderr.lower() or "root" in stderr.lower() or "bpf" in stderr.lower():
            raise C9R5RunnerError("PACKET_CAPTURE_PERMISSION_REQUIRED", "manual_admin_command_required")
        raise C9R5RunnerError("PACKET_CAPTURE_START_FAILED", f"rc={tcpdump.returncode}")
    guest_result = subprocess.run(
        _guest_connect_args(),
        env=_sanitized_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=8,
        check=False,
    )
    stdout, stderr, capture_timed_out = _safe_terminate(tcpdump)
    if tcpdump.returncode not in (0, -signal.SIGTERM):
        if "permission" in stderr.lower() or "root" in stderr.lower() or "bpf" in stderr.lower():
            raise C9R5RunnerError("PACKET_CAPTURE_PERMISSION_REQUIRED", "manual_admin_command_required")
        raise C9R5RunnerError("PACKET_CAPTURE_FAILED", f"rc={tcpdump.returncode}")
    packet_summary = _parse_tcpdump_summary(stdout)
    return {
        "result": "PASS",
        "mode": "execute-probe",
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
            "packet_capture_allowed": True,
            "packet_capture_performed": True,
            "packet_capture_raw_output_persisted": False,
            "guest_traffic_generation_allowed": True,
            "guest_traffic_generated": True,
            "guest_dns_query_allowed": False,
            "production_profiles_allowed": False,
            "real_credentials_allowed": False,
            "gateway_changes_allowed": False,
            "canary_allowed": False,
            "reclaim_delete_allowed": False,
        },
        "target": {
            "instance_name": contract_result["target_instance"],
            "guest_ipv4": contract_result["target_guest_ipv4"],
            "candidate_host_interface": CAPTURE_INTERFACE,
        },
        "probe": {
            "capture_filter": CAPTURE_FILTER,
            "capture_max_packets": 8,
            "capture_max_seconds": 12,
            "capture_timed_out": capture_timed_out,
            "guest_connect_target": "1.1.1.1:443",
            "guest_connect_returncode": guest_result.returncode,
            "guest_stdout_persisted": False,
            "guest_stderr_persisted": False,
            "packet_summary": packet_summary,
        },
        "c9_r6_implications": {
            "pf_pre_nat_visibility_supported": packet_summary["pre_nat_guest_source_observed"],
            "target_uniqueness_proven": False,
            "firewall_execution_contract_ready": False,
            "reason": "Packet visibility can support or reject pre-NAT source visibility, but target uniqueness and rollback-safe firewall execution remain separate gates."
        },
        "raw_packet_output_persisted": False,
        "next_gate": "PHASE_1B_C9_R6_TARGET_UNIQUENESS_OR_FIREWALL_EXECUTION_BLOCK",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["preflight", "print-admin-command", "execute-probe"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--approval-record", type=Path, default=DEFAULT_APPROVAL_RECORD)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "preflight":
            _json_print(preflight(args.contract, args.approval_record))
            return 0
        if args.mode == "print-admin-command":
            _json_print(print_admin_command(args.contract, args.approval_record))
            return 0
        if args.mode == "execute-probe":
            _json_print(execute_probe(args.contract, args.approval_record))
            return 0
    except (C9R5RunnerError, ManifestError, json.JSONDecodeError, subprocess.TimeoutExpired) as error:
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
