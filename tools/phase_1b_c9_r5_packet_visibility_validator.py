#!/usr/bin/env python3
"""Validate the Phase 1B-C9 R5 packet visibility probe contract.

This validator is read-only. It does not execute tcpdump, does not execute
pfctl, does not generate guest traffic, and does not mutate firewall or runtime
state.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import ManifestError, canonical_json_bytes, load_json


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R5_PACKET_VISIBILITY_PROBE_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c9-r5.synthetic-lima-packet-visibility-probe-contract.v1"
EXPECTED_CONTRACT_SHA = "697deae9aeec4518a6edcd6d5986c1ae6dfda1d2cad5b096c8b2c1851d7c5928"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_PACKET_VISIBILITY_PROBE"


class C9R5ValidationError(RuntimeError):
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


def owner_command_hash(approval_id: str, content_sha: str) -> str:
    command = f"{APPROVAL_PREFIX}:{approval_id}:{content_sha}"
    return hashlib.sha256(command.encode("utf-8")).hexdigest()


def _assert_file_sha(path_text: str, expected_sha: str) -> None:
    path = PROJECT_ROOT / path_text
    if not path.is_file():
        raise C9R5ValidationError("SOURCE_EVIDENCE_MISSING", path_text)
    actual = _sha256_file(path)
    if actual != expected_sha:
        raise C9R5ValidationError("SOURCE_EVIDENCE_SHA_MISMATCH", path_text)


def validate_contract(contract_path: Path = DEFAULT_CONTRACT) -> dict:
    try:
        contract = load_json(contract_path)
    except ManifestError as error:
        raise C9R5ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C9R5ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C9R5ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C9R5ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R5ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C9R5ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C9R5ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != "p1b-20260722-limapktc9r5":
        raise C9R5ValidationError("APPROVAL_ID_UNEXPECTED")
    if content.get("candidate_host_interface") != "utun4":
        raise C9R5ValidationError("CANDIDATE_INTERFACE_UNEXPECTED")
    if content.get("target_guest_ipv4") != "192.168.5.15":
        raise C9R5ValidationError("TARGET_GUEST_IPV4_UNEXPECTED")
    if content.get("packet_capture_interface") != "utun4":
        raise C9R5ValidationError("PACKET_CAPTURE_INTERFACE_UNEXPECTED")
    if content.get("packet_capture_filter") != "host 192.168.5.15 and tcp and port 443":
        raise C9R5ValidationError("PACKET_CAPTURE_FILTER_UNEXPECTED")
    if content.get("packet_capture_max_packets") != 8:
        raise C9R5ValidationError("PACKET_CAPTURE_COUNT_UNEXPECTED")
    if content.get("packet_capture_max_seconds") != 12:
        raise C9R5ValidationError("PACKET_CAPTURE_TIMEOUT_UNEXPECTED")
    expected_false_fields = (
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "pf_config_edits_allowed",
        "packet_capture_payload_persistence_allowed",
        "packet_capture_raw_output_persistence_allowed",
        "guest_payload_capture_allowed",
        "guest_dns_query_allowed",
        "host_sync_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "reclaim_delete_allowed",
    )
    for field in expected_false_fields:
        if content.get(field) is not False:
            raise C9R5ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if content.get("packet_capture_allowed") is not True:
        raise C9R5ValidationError("PACKET_CAPTURE_NOT_MARKED_AS_APPROVABLE")
    if content.get("guest_traffic_generation_allowed") is not True:
        raise C9R5ValidationError("GUEST_TRAFFIC_GENERATION_NOT_MARKED_AS_APPROVABLE")
    runner_policy = content.get("runner_after_approval", {})
    if runner_policy.get("automatic_privileged_execution_allowed") is not False:
        raise C9R5ValidationError("AUTOMATIC_PRIVILEGED_EXECUTION_UNEXPECTEDLY_ALLOWED")
    if runner_policy.get("print_admin_command_allowed") is not True:
        raise C9R5ValidationError("ADMIN_COMMAND_PRINT_NOT_ALLOWED")
    if "/sbin/pfctl" not in content.get("tool_denylist_even_after_approval", []):
        raise C9R5ValidationError("PFCTL_NOT_DENYLISTED")
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise C9R5ValidationError("SOURCE_EVIDENCE_INVALID")
    _assert_file_sha(
        "security/evidence/phase-1b-c9-r4/host-network-observability-execution-summary.json",
        source["c9_r4_execution_summary_sha256"],
    )
    return {
        "result": "PASS",
        "mode": "validate-contract",
        "approval_id": content["approval_id"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_command_hash": owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA),
        "target_instance": content["instance_name"],
        "target_guest_ipv4": content["target_guest_ipv4"],
        "candidate_host_interface": content["candidate_host_interface"],
        "packet_visibility_probe_authorized": False,
        "packet_capture_approval_required": True,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-contract"])
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-contract":
            _json_print(validate_contract(args.contract))
            return 0
    except (C9R5ValidationError, ManifestError, json.JSONDecodeError) as error:
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
