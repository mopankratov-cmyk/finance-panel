#!/usr/bin/env python3
"""Validate the Phase 1C-A2 profile runtime threat model.

This validator is read-only. It does not call sandbox providers, read
credentials, start profiles, or mutate Hermes runtime state.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_THREAT_MODEL = PROJECT_ROOT / "security/evidence/phase-1c-a2/profile-runtime-threat-model.json"
EXPECTED_SCHEMA = "pankster.phase1c-a2.profile-runtime-threat-model.v1"
EXPECTED_DECISION = "REMOTE_SANDBOX_REQUIRES_HOST_SIDE_CREDENTIAL_AND_MODEL_BROKERS"


class Phase1CA2ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_json(path: Path) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1CA2ValidationError("THREAT_MODEL_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA2ValidationError("THREAT_MODEL_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA2ValidationError("THREAT_MODEL_NOT_OBJECT")
    return payload


def validate_threat_model(path: Path = DEFAULT_THREAT_MODEL) -> dict:
    model = _load_json(path)
    if model.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA2ValidationError("SCHEMA_INVALID")
    if model.get("result") != "THREAT_MODEL_COMPLETE_NO_RUNTIME_APPROVED":
        raise Phase1CA2ValidationError("RESULT_INVALID")
    if model.get("decision") != EXPECTED_DECISION:
        raise Phase1CA2ValidationError("DECISION_INVALID")
    if model.get("runtime_approved") is not False:
        raise Phase1CA2ValidationError("RUNTIME_UNEXPECTEDLY_APPROVED")
    if model.get("implementation_ready") is not False:
        raise Phase1CA2ValidationError("IMPLEMENTATION_UNEXPECTEDLY_READY")

    a1_input = model.get("a1_input")
    if not isinstance(a1_input, dict):
        raise Phase1CA2ValidationError("A1_INPUT_INVALID")
    if a1_input.get("shortlist") != ["modal_sandbox", "e2b_sandbox"]:
        raise Phase1CA2ValidationError("A1_SHORTLIST_INVALID")

    assets = model.get("protected_assets")
    if not isinstance(assets, dict):
        raise Phase1CA2ValidationError("PROTECTED_ASSETS_INVALID")
    for field, value in assets.items():
        if value is not True:
            raise Phase1CA2ValidationError(f"{field.upper()}_NOT_PROTECTED")

    boundaries = model.get("required_boundaries")
    if not isinstance(boundaries, dict):
        raise Phase1CA2ValidationError("REQUIRED_BOUNDARIES_INVALID")
    expected_false = (
        "sandbox_receives_root_auth",
        "sandbox_receives_non_profile_service_credentials",
        "sandbox_receives_raw_host_environment",
        "sandbox_receives_unrestricted_filesystem_mount",
    )
    for field in expected_false:
        if boundaries.get(field) is not False:
            raise Phase1CA2ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")
    expected_true = (
        "deny_by_default_network_before_worker_code",
        "host_side_model_broker_preferred",
        "in_sandbox_model_auth_requires_per_profile_minimal_token",
        "host_side_capability_broker_required_for_external_services",
        "sanitized_environment_inherited_by_children",
        "fail_closed_before_user_code_on_policy_failure",
        "sanitized_evidence_only",
    )
    for field in expected_true:
        if boundaries.get(field) is not True:
            raise Phase1CA2ValidationError(f"{field.upper()}_MISSING")

    blocked = model.get("adversary_goals_blocked_by_design")
    if not isinstance(blocked, dict):
        raise Phase1CA2ValidationError("ADVERSARY_GOALS_INVALID")
    for field, value in blocked.items():
        if value is not True:
            raise Phase1CA2ValidationError(f"{field.upper()}_NOT_BLOCKED")

    forbidden = model.get("forbidden_in_a2")
    if not isinstance(forbidden, dict):
        raise Phase1CA2ValidationError("FORBIDDEN_IN_A2_INVALID")
    for field, value in forbidden.items():
        if value is not False:
            raise Phase1CA2ValidationError(f"{field.upper()}_UNEXPECTEDLY_PERFORMED")

    if model.get("next_gate") != "PHASE_1C_A3_ISOLATION_PROOF_CONTRACT":
        raise Phase1CA2ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-threat-model",
        "decision": EXPECTED_DECISION,
        "runtime_approved": False,
        "implementation_ready": False,
        "next_gate": "PHASE_1C_A3_ISOLATION_PROOF_CONTRACT",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-threat-model"])
    parser.add_argument("--threat-model", type=Path, default=DEFAULT_THREAT_MODEL)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-threat-model":
            _json_print(validate_threat_model(args.threat_model))
            return 0
    except (Phase1CA2ValidationError, json.JSONDecodeError) as error:
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
