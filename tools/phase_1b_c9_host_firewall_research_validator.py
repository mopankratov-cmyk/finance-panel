#!/usr/bin/env python3
"""Validate the Phase 1B-C9 host-firewall research contract.

This validator is read-only. It does not execute pfctl, does not edit pf
configuration, does not start a VM, and does not touch runtime state.
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


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1B_C9_HOST_FIREWALL_RESEARCH_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1b-c9.synthetic-lima-host-firewall-research-contract.v1"
EXPECTED_CONTRACT_SHA = "360d4f746e7ef7cb225b8da333b7dec739c5d8d6175c24a89150dd34f2ddd2c5"
APPROVAL_PREFIX = "APPROVE_SYNTHETIC_LIMA_HOST_FIREWALL_RESEARCH"


class C9ValidationError(RuntimeError):
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
        raise C9ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise C9ValidationError("CONTRACT_SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise C9ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise C9ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise C9ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise C9ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise C9ValidationError("CONTRACT_EXPIRED")
    if content.get("host_firewall_changes_allowed_by_preparation") is not False:
        raise C9ValidationError("HOST_FIREWALL_UNEXPECTEDLY_ALLOWED")
    if content.get("host_firewall_changes_require_future_approval") is not True:
        raise C9ValidationError("FUTURE_FIREWALL_APPROVAL_REQUIRED")
    for field in (
        "production_profiles_allowed",
        "real_credentials_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "host_sync_allowed",
        "guest_writes_allowed_by_preparation",
    ):
        if content.get(field) is not False:
            raise C9ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    if content.get("future_experiment_requires_new_disposable_vm") is not True:
        raise C9ValidationError("NEW_DISPOSABLE_VM_REQUIRED")
    if content.get("existing_pc3_reuse_for_production_candidate_allowed") is not False:
        raise C9ValidationError("EXISTING_PC3_REUSE_UNEXPECTEDLY_ALLOWED")
    if content.get("pf_anchor_name") != "com.apple/pankster_phase1b_c9":
        raise C9ValidationError("PF_ANCHOR_NAME_UNEXPECTED")
    pfctl_path = Path(content["pfctl_path"])
    if not pfctl_path.is_absolute() or not pfctl_path.exists():
        raise C9ValidationError("PFCTL_PATH_INVALID")
    pf_main = Path(content["pf_main_config_path"])
    if str(pf_main) != "/etc/pf.conf" or not pf_main.is_file():
        raise C9ValidationError("PF_MAIN_CONFIG_INVALID")
    if _sha256_file(pf_main) != content["pf_main_config_sha256"]:
        raise C9ValidationError("PF_MAIN_CONFIG_SHA_MISMATCH")
    if 'anchor "com.apple/*"' not in pf_main.read_text(encoding="utf-8"):
        raise C9ValidationError("PF_COM_APPLE_ANCHOR_MISSING")
    templates = content.get("future_pf_rule_template")
    if templates != [
        "block drop quick from <GUEST_IPV4> to any",
        "block drop quick to <GUEST_IPV4> from any",
    ]:
        raise C9ValidationError("PF_RULE_TEMPLATE_UNEXPECTED")
    if content.get("future_pf_rule_template_placeholders_must_be_resolved_before_load") is not True:
        raise C9ValidationError("PF_PLACEHOLDER_RESOLUTION_REQUIRED")
    for evidence_name, expected_sha in content["source_evidence"].items():
        if evidence_name == "c5_egress_classification_sha256":
            evidence_path = PROJECT_ROOT / "security/evidence/phase-1b-c5/egress-classification-execution-summary.json"
        elif evidence_name == "c8_static_containment_review_sha256":
            evidence_path = PROJECT_ROOT / "security/evidence/phase-1b-c8/static-containment-review.json"
        else:
            raise C9ValidationError("SOURCE_EVIDENCE_UNEXPECTED", evidence_name)
        if _sha256_file(evidence_path) != expected_sha:
            raise C9ValidationError("SOURCE_EVIDENCE_SHA_MISMATCH", evidence_name)
    return {
        "result": "PASS",
        "mode": "validate-contract",
        "approval_id": content["approval_id"],
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "owner_command_hash": owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA),
        "host_firewall_execution_authorized": False,
        "host_firewall_changes_performed": False,
        "future_experiment_requires_owner_approval": True,
        "future_experiment_requires_new_disposable_vm": True,
        "production_profiles_allowed": False,
        "real_credentials_allowed": False,
        "gateway_changes_allowed": False,
        "canary_allowed": False,
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
    except (C9ValidationError, ManifestError, json.JSONDecodeError) as error:
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
