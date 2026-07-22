#!/usr/bin/env python3
"""Validate the Phase 1B-C9 R4 host network observability discovery contract.

This validator is read-only. It does not execute host network tools, does not
execute pfctl, does not capture packets, does not call into Lima guests, and does
not mutate firewall or runtime state.
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R4_HOST_NETWORK_OBSERVABILITY_DISCOVERY_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c9-r4.synthetic-lima-host-network-observability-discovery-contract.v1"
EXPECTED_CONTRACT_SHA = "5fdbb97f712a83c4de1b7321cf388c5255d870dbbfe9524dec96138ed5d8e8c9"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_HOST_NETWORK_OBSERVABILITY"
EXPECTED_TOOL_ALLOWLIST = [
    "/sbin/ifconfig",
    "/usr/sbin/netstat",
    "/sbin/route",
]
EXPECTED_TOOL_DENYLIST = [
    "/sbin/pfctl",
    "/usr/sbin/tcpdump",
    "/usr/bin/nc",
    "/usr/bin/curl",
    "/usr/bin/ssh",
    "/usr/bin/scp",
    "/usr/bin/rsync",
    "/usr/bin/sudo",
]


class C9R4ValidationError(RuntimeError):
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
        raise C9R4ValidationError("SOURCE_EVIDENCE_MISSING", path_text)
    actual = _sha256_file(path)
    if actual != expected_sha:
        raise C9R4ValidationError("SOURCE_EVIDENCE_SHA_MISMATCH", path_text)


def validate_contract(contract_path: Path = DEFAULT_CONTRACT) -> dict:
    try:
        contract = load_json(contract_path)
    except ManifestError as error:
        raise C9R4ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C9R4ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C9R4ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C9R4ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R4ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C9R4ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C9R4ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != "p1b-20260722-limaobsc9r4":
        raise C9R4ValidationError("APPROVAL_ID_UNEXPECTED")
    if content.get("network_observability_only") is not True:
        raise C9R4ValidationError("NETWORK_OBSERVABILITY_ONLY_REQUIRED")
    if content.get("instance_name") != "pc9r2":
        raise C9R4ValidationError("INSTANCE_NAME_UNEXPECTED")
    if content.get("lima_home") != "/Users/maksimpankratov/.local/pankster/runtime/lc9r2":
        raise C9R4ValidationError("LIMA_HOME_UNEXPECTED")
    if content.get("target_guest_ipv4") != "192.168.5.15":
        raise C9R4ValidationError("TARGET_GUEST_IPV4_UNEXPECTED")
    if content.get("target_guest_prefix") != 24:
        raise C9R4ValidationError("TARGET_GUEST_PREFIX_UNEXPECTED")
    for field in (
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "pf_config_edits_allowed",
        "packet_capture_allowed",
        "guest_traffic_generation_allowed",
        "guest_writes_allowed",
        "host_sync_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "reclaim_delete_allowed",
    ):
        if content.get(field) is not False:
            raise C9R4ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if content.get("tool_allowlist") != EXPECTED_TOOL_ALLOWLIST:
        raise C9R4ValidationError("TOOL_ALLOWLIST_UNEXPECTED")
    if content.get("tool_denylist") != EXPECTED_TOOL_DENYLIST:
        raise C9R4ValidationError("TOOL_DENYLIST_UNEXPECTED")
    for denied in EXPECTED_TOOL_DENYLIST:
        if denied in content["tool_allowlist"]:
            raise C9R4ValidationError("DENIED_TOOL_IN_ALLOWLIST", denied)
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise C9R4ValidationError("SOURCE_EVIDENCE_INVALID")
    _assert_file_sha(
        "security/evidence/phase-1b-c9-r2/firewall-target-discovery-execution-summary.json",
        source["c9_r2_execution_summary_sha256"],
    )
    _assert_file_sha(
        "security/evidence/phase-1b-c9-r3/host-firewall-execution-precheck.json",
        source["c9_r3_execution_precheck_sha256"],
    )
    _assert_file_sha(
        "docs/program/PHASE_1B_C9_R3_PF_VISIBILITY_AND_TARGET_UNIQUENESS_REVIEW.md",
        source["c9_r3_review_doc_sha256"],
    )
    _assert_file_sha(
        "security/evidence/phase-1b-c9-r3/pf-visibility-target-uniqueness-review.json",
        source["c9_r3_review_summary_sha256"],
    )
    return {
        "result": "PASS",
        "mode": "validate-contract",
        "approval_id": content["approval_id"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_command_hash": owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA),
        "target_instance": content["instance_name"],
        "target_guest_ipv4": content["target_guest_ipv4"],
        "host_network_observability_authorized": False,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "packet_capture_allowed": False,
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
    except (C9R4ValidationError, ManifestError, json.JSONDecodeError) as error:
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

