#!/usr/bin/env python3
"""Validate the Phase 1C-A3 isolation proof contract.

This validator is read-only. It does not call providers, create sandboxes, read
credentials, or execute Hermes profiles.
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

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_CONTRACT = PROJECT_ROOT / "docs/program/PHASE_1C_A3_ISOLATION_PROOF_CONTRACT.ready.json"
EXPECTED_SCHEMA = "pankster.phase1c-a3.isolation-proof-contract.v1"
EXPECTED_CONTRACT_SHA = "cad565e56c421e65b5629136eea366df30ce7b3d72250ccce9afb89779411f1d"


class Phase1CA3ValidationError(RuntimeError):
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


def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1CA3ValidationError("CONTRACT_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA3ValidationError("CONTRACT_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA3ValidationError("CONTRACT_NOT_OBJECT")
    return payload


def validate_contract(path: Path = DEFAULT_CONTRACT) -> dict:
    contract = _load_json(path)
    if contract.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA3ValidationError("SCHEMA_INVALID")
    if contract.get("contract_state") != "READY_FOR_OWNER_REVIEW":
        raise Phase1CA3ValidationError("CONTRACT_STATE_INVALID")
    content = contract.get("contract_content")
    if not isinstance(content, dict):
        raise Phase1CA3ValidationError("CONTRACT_CONTENT_INVALID")
    if contract.get("content_sha256") != EXPECTED_CONTRACT_SHA:
        raise Phase1CA3ValidationError("CONTRACT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTRACT_SHA:
        raise Phase1CA3ValidationError("CONTRACT_CONTENT_SHA_MISMATCH")
    if _now() >= _parse_time(content["expires_at"]):
        raise Phase1CA3ValidationError("CONTRACT_EXPIRED")
    if content.get("candidate_scope") != ["modal_sandbox", "e2b_sandbox"]:
        raise Phase1CA3ValidationError("CANDIDATE_SCOPE_INVALID")
    if content.get("provider_api_calls_allowed_before_a4") is not False:
        raise Phase1CA3ValidationError("PROVIDER_CALLS_ALLOWED_BEFORE_A4")
    if content.get("synthetic_only") is not True:
        raise Phase1CA3ValidationError("SYNTHETIC_ONLY_MISSING")

    for field in (
        "real_credentials_allowed",
        "production_profiles_allowed",
        "gateway_changes_allowed",
        "canary_allowed",
        "host_firewall_changes_allowed",
        "auth_files_read_allowed",
        "keychain_read_allowed",
        "environment_value_dump_allowed",
    ):
        if content.get(field) is not False:
            raise Phase1CA3ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")

    synthetic_credentials = content.get("synthetic_credentials")
    if not isinstance(synthetic_credentials, dict):
        raise Phase1CA3ValidationError("SYNTHETIC_CREDENTIALS_INVALID")
    if synthetic_credentials.get("fake_profile_model_token_allowed") is not True:
        raise Phase1CA3ValidationError("FAKE_TOKEN_NOT_ALLOWED_FOR_SYNTHETIC_PROOF")
    for field in ("real_model_token_allowed", "root_auth_json_allowed", "root_credential_pool_allowed"):
        if synthetic_credentials.get(field) is not False:
            raise Phase1CA3ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")

    required_proofs = content.get("required_proofs")
    if not isinstance(required_proofs, dict):
        raise Phase1CA3ValidationError("REQUIRED_PROOFS_INVALID")
    for field, value in required_proofs.items():
        if value is not True:
            raise Phase1CA3ValidationError(f"{field.upper()}_NOT_REQUIRED")

    pass_criteria = content.get("pass_criteria")
    if not isinstance(pass_criteria, dict):
        raise Phase1CA3ValidationError("PASS_CRITERIA_INVALID")
    for field, value in pass_criteria.items():
        if value is not True:
            raise Phase1CA3ValidationError(f"{field.upper()}_NOT_REQUIRED")

    return {
        "result": "PASS",
        "mode": "validate-contract",
        "contract_content_sha256": EXPECTED_CONTRACT_SHA,
        "candidate_scope": ["modal_sandbox", "e2b_sandbox"],
        "execution_approved": False,
        "provider_api_calls_allowed_before_a4": False,
        "next_gate": "PHASE_1C_A4_OWNER_APPROVAL_PACKET",
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
    except (Phase1CA3ValidationError, json.JSONDecodeError) as error:
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
