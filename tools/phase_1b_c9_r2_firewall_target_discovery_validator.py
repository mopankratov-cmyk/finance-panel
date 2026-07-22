#!/usr/bin/env python3
"""Validate the Phase 1B-C9 R2 firewall target discovery contract.

This validator is read-only. It does not start Lima, does not execute pfctl,
does not mutate firewall state, and does not touch production runtime state.
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_R2_FIREWALL_TARGET_DISCOVERY_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c9-r2.synthetic-lima-firewall-target-discovery-contract.v1"
EXPECTED_CONTRACT_SHA = "3048d2668b5c224ec98bdb0cb1aca865f6fa5e8070e4432833c1c034db6c8b4d"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_FIREWALL_TARGET_DISCOVERY"


class C9R2ValidationError(RuntimeError):
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


def validate_contract(contract_path: Path = DEFAULT_CONTRACT) -> dict:
    try:
        contract = load_json(contract_path)
    except ManifestError as error:
        raise C9R2ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C9R2ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C9R2ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C9R2ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9R2ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C9R2ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C9R2ValidationError("CONTRACT_EXPIRED")
    if content.get("target_discovery_only") is not True:
        raise C9R2ValidationError("TARGET_DISCOVERY_ONLY_REQUIRED")
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
            raise C9R2ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if content.get("target_guest_ipv4_unknown_until_execution") is not True:
        raise C9R2ValidationError("TARGET_IP_MUST_BE_UNKNOWN_PRE_EXECUTION")
    if content.get("target_guest_ipv4_must_be_recorded_before_c9_r3") is not True:
        raise C9R2ValidationError("TARGET_IP_RECORD_REQUIRED")
    if content.get("target_vm_reuse_for_production_candidate_allowed") is not False:
        raise C9R2ValidationError("TARGET_VM_REUSE_UNEXPECTEDLY_ALLOWED")
    if content.get("instance_name") != "pc9r2":
        raise C9R2ValidationError("INSTANCE_NAME_UNEXPECTED")
    if content.get("lima_home") != "/Users/maksimpankratov/.local/pankster/runtime/lc9r2":
        raise C9R2ValidationError("LIMA_HOME_UNEXPECTED")
    limactl_path = Path(content["limactl_path"])
    if not limactl_path.is_file() or limactl_path.is_symlink():
        raise C9R2ValidationError("LIMACTL_PATH_INVALID")
    if _sha256_file(limactl_path) != content["limactl_binary_sha256"]:
        raise C9R2ValidationError("LIMACTL_SHA_MISMATCH")
    config_path = PROJECT_ROOT / content["config_path"]
    if _sha256_file(config_path) != content["config_sha256"]:
        raise C9R2ValidationError("CONFIG_SHA_MISMATCH")
    approval_record_path = PROJECT_ROOT / "docs/program/PHASE_1B_C9_HOST_FIREWALL_RESEARCH_APPROVAL_RECORD.json"
    if _sha256_file(approval_record_path) != content["source_evidence"]["c9_research_approval_record_sha256"]:
        raise C9R2ValidationError("C9_APPROVAL_RECORD_SHA_MISMATCH")
    return {
        "result": "PASS",
        "mode": "validate-contract",
        "approval_id": content["approval_id"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_command_hash": owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA),
        "target_instance": content["instance_name"],
        "target_lima_home": content["lima_home"],
        "target_discovery_execution_authorized": False,
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
    except (C9R2ValidationError, ManifestError, json.JSONDecodeError) as error:
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
