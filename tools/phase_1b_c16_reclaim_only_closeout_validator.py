#!/usr/bin/env python3
"""Validate the Phase 1B-C16 reclaim-only closeout contract.

This validator is read-only. It does not stop or delete VMs, does not invoke
limactl, does not read auth files, and does not mutate runtime state.
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C16_RECLAIM_ONLY_CLOSEOUT_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c16.reclaim-only-closeout-contract.v1"
EXPECTED_CONTRACT_SHA = "315f08ddf8dd4220127b33e880074c49e012941bdc1365aad7db424a5daa473d"
APPROVAL_PREFIX = "APPROVE_PHASE_1B_RECLAIM_ONLY_CLOSEOUT"
EXPECTED_OWNER_COMMAND_HASH = "5817cdcdec8dd1664c4002cc3a3547e4804510130b907a9a9517141ce949f0ef"
EXPECTED_TARGETS = {
    "pc3": "/Users/maksimpankratov/.local/pankster/runtime/lc3",
    "pc9r2": "/Users/maksimpankratov/.local/pankster/runtime/lc9r2",
}


class C16ReclaimValidationError(RuntimeError):
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


def owner_command(content_sha: str) -> str:
    return f"{APPROVAL_PREFIX}:p1b-20260722-reclaimonlyc16:{content_sha}"


def _assert_source_sha(path_text: str, expected_sha: str) -> None:
    path = PROJECT_ROOT / path_text
    if not path.is_file():
        raise C16ReclaimValidationError("SOURCE_EVIDENCE_MISSING", path_text)
    actual = _sha256_file(path)
    if actual != expected_sha:
        raise C16ReclaimValidationError("SOURCE_EVIDENCE_SHA_MISMATCH", path_text)


def validate_contract(contract_path: Path = DEFAULT_CONTRACT) -> dict:
    try:
        contract = load_json(contract_path)
    except ManifestError as error:
        raise C16ReclaimValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C16ReclaimValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C16ReclaimValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C16ReclaimValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C16ReclaimValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C16ReclaimValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C16ReclaimValidationError("CONTRACT_EXPIRED")
    if hashlib.sha256(owner_command(EXPECTED_CONTRACT_SHA).encode("utf-8")).hexdigest() != EXPECTED_OWNER_COMMAND_HASH:
        raise C16ReclaimValidationError("OWNER_COMMAND_HASH_UNEXPECTED")
    if content.get("manual_owner_approval_required") is not True:
        raise C16ReclaimValidationError("OWNER_APPROVAL_NOT_REQUIRED")
    if content.get("codex_reclaim_execution_allowed_before_approval") is not False:
        raise C16ReclaimValidationError("RECLAIM_ALLOWED_BEFORE_APPROVAL")
    targets = content.get("targets")
    if not isinstance(targets, list) or len(targets) != 2:
        raise C16ReclaimValidationError("TARGETS_INVALID")
    target_map = {target.get("instance_name"): target.get("lima_home") for target in targets}
    if target_map != EXPECTED_TARGETS:
        raise C16ReclaimValidationError("TARGET_SCOPE_UNEXPECTED", json.dumps(target_map, sort_keys=True))
    commands = content.get("exact_commands")
    command_hashes = content.get("exact_command_sha256")
    if not isinstance(commands, dict) or not isinstance(command_hashes, dict):
        raise C16ReclaimValidationError("COMMANDS_INVALID")
    for name, command in commands.items():
        if name not in command_hashes:
            raise C16ReclaimValidationError("COMMAND_HASH_MISSING", name)
        if hashlib.sha256(command.encode("utf-8")).hexdigest() != command_hashes[name]:
            raise C16ReclaimValidationError("COMMAND_HASH_MISMATCH", name)
        if " rm -rf " in f" {command} ":
            raise C16ReclaimValidationError("RM_RF_COMMAND_FORBIDDEN", name)
        if "*" in command:
            raise C16ReclaimValidationError("WILDCARD_COMMAND_FORBIDDEN", name)
        if "LIMA_HOME=/Users/maksimpankratov/.lima" in command:
            raise C16ReclaimValidationError("DEFAULT_LIMA_HOME_FORBIDDEN", name)
    expected_false_fields = (
        "wildcard_delete_allowed",
        "broad_path_delete_allowed",
        "rm_rf_allowed",
        "default_lima_home_allowed",
        "pfctl_execution_allowed",
        "host_firewall_changes_allowed",
        "gateway_changes_allowed",
        "production_profiles_allowed",
        "real_credentials_allowed",
        "canary_allowed",
        "network_probe_allowed",
        "auth_files_read_allowed",
        "keychain_read_allowed",
        "environment_value_dump_allowed",
        "evidence_deletion_allowed",
    )
    for field in expected_false_fields:
        if content.get(field) is not False:
            raise C16ReclaimValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise C16ReclaimValidationError("SOURCE_EVIDENCE_INVALID")
    _assert_source_sha(source["c9_r6_block_path"], source["c9_r6_block_sha256"])
    return {
        "result": "PASS",
        "mode": "validate-contract",
        "approval_id": content["approval_id"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_command_hash": EXPECTED_OWNER_COMMAND_HASH,
        "targets": target_map,
        "manual_owner_approval_required": True,
        "reclaim_execution_performed": False,
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
    except (C16ReclaimValidationError, ManifestError, json.JSONDecodeError) as error:
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
