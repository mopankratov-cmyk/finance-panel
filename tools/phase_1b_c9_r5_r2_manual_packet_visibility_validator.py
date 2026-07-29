#!/usr/bin/env python3
"""Validate the Phase 1B-C9 R5 R2 manual packet visibility procedure contract.

This validator is read-only. It does not execute tcpdump, does not execute
pfctl, does not generate guest traffic, and does not mutate firewall/runtime
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R5_R2_MANUAL_PACKET_VISIBILITY_PROCEDURE_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c9-r5-r2.synthetic-lima-manual-packet-visibility-procedure-contract.v1"
EXPECTED_CONTRACT_SHA = "6c2a9e75d06ce1d43af1df2d3b0a581ef040ce71488c6d70d7705e0f89067a03"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_MANUAL_PACKET_VISIBILITY_PROCEDURE"
EXPECTED_CAPTURE_COMMAND_SHA = "3cd21e956f5c1f24301162e5c395b627b83f3698c615eea910b4e2fd0a114b90"
EXPECTED_TRIGGER_COMMAND_SHA = "cff4d31c6fb090b1b100aef2a6a447aab92f369e6f0652666da909ad53550f3f"


class C9R5R2ValidationError(RuntimeError):
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
        raise C9R5R2ValidationError("SOURCE_EVIDENCE_MISSING", path_text)
    actual = _sha256_file(path)
    if actual != expected_sha:
        raise C9R5R2ValidationError("SOURCE_EVIDENCE_SHA_MISMATCH", path_text)


def validate_contract(contract_path: Path = DEFAULT_CONTRACT) -> dict:
    try:
        contract = load_json(contract_path)
    except ManifestError as error:
        raise C9R5R2ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C9R5R2ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C9R5R2ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C9R5R2ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R5R2ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C9R5R2ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C9R5R2ValidationError("CONTRACT_EXPIRED")
    if content.get("approval_id") != "p1b-20260722-limapktr2c9r5":
        raise C9R5R2ValidationError("APPROVAL_ID_UNEXPECTED")
    if content.get("candidate_host_interface") != "utun4":
        raise C9R5R2ValidationError("CANDIDATE_INTERFACE_UNEXPECTED")
    if content.get("target_guest_ipv4") != "192.168.5.15":
        raise C9R5R2ValidationError("TARGET_GUEST_IPV4_UNEXPECTED")
    if content.get("packet_capture_command_sha256") != EXPECTED_CAPTURE_COMMAND_SHA:
        raise C9R5R2ValidationError("CAPTURE_COMMAND_SHA_UNEXPECTED")
    if content.get("synthetic_guest_trigger_command_sha256") != EXPECTED_TRIGGER_COMMAND_SHA:
        raise C9R5R2ValidationError("TRIGGER_COMMAND_SHA_UNEXPECTED")
    if content.get("manual_operator_action_required") is not True:
        raise C9R5R2ValidationError("MANUAL_OPERATOR_ACTION_REQUIRED")
    if content.get("codex_automatic_privileged_execution_allowed") is not False:
        raise C9R5R2ValidationError("CODEX_PRIVILEGED_EXECUTION_UNEXPECTEDLY_ALLOWED")
    if content.get("operator_must_not_paste_raw_packet_lines") is not True:
        raise C9R5R2ValidationError("RAW_PACKET_LINE_PROHIBITION_MISSING")
    return_format = content.get("operator_return_format")
    if not isinstance(return_format, dict):
        raise C9R5R2ValidationError("OPERATOR_RETURN_FORMAT_INVALID")
    if return_format.get("raw_packet_output_persisted") is not False:
        raise C9R5R2ValidationError("RAW_PACKET_OUTPUT_PERSISTENCE_UNEXPECTEDLY_ALLOWED")
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
            raise C9R5R2ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if "/sbin/pfctl" not in content.get("tool_denylist_even_after_approval", []):
        raise C9R5R2ValidationError("PFCTL_NOT_DENYLISTED")
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise C9R5R2ValidationError("SOURCE_EVIDENCE_INVALID")
    _assert_file_sha(
        "security/evidence/phase-1b-c9-r5/packet-visibility-execution-block.json",
        source["c9_r5_execution_block_sha256"],
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
        "manual_operator_action_required": True,
        "codex_automatic_privileged_execution_allowed": False,
        "pfctl_execution_allowed": False,
        "host_firewall_changes_allowed": False,
        "raw_packet_output_persistence_allowed": False,
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
    except (C9R5R2ValidationError, ManifestError, json.JSONDecodeError) as error:
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

