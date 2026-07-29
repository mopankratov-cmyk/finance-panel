#!/usr/bin/env python3
"""Validate the Phase 1C-A0 runtime isolation backend reselection baseline.

This validator is read-only. It does not install runtimes, start profiles,
touch credentials, mutate the gateway, or run network/firewall probes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a0/runtime-isolation-backend-reselection.json"
EXPECTED_SCHEMA = "pankster.phase1c-a0.runtime-isolation-backend-reselection.v1"
EXPECTED_RESULT = "START_NEW_ARCHITECTURE_PATH_NOT_IMPLEMENTATION_READY"


class Phase1CA0ValidationError(RuntimeError):
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
        raise Phase1CA0ValidationError("EVIDENCE_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA0ValidationError("EVIDENCE_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA0ValidationError("EVIDENCE_NOT_OBJECT")
    return payload


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path)
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA0ValidationError("SCHEMA_INVALID")
    if evidence.get("result") != EXPECTED_RESULT:
        raise Phase1CA0ValidationError("RESULT_INVALID")

    phase_1b_inputs = evidence.get("phase_1b_inputs")
    if not isinstance(phase_1b_inputs, dict):
        raise Phase1CA0ValidationError("PHASE_1B_INPUTS_INVALID")
    for field in (
        "lima_vz_standalone_backend_rejected",
        "c5_egress_observed",
        "c9_r6_firewall_execution_blocked",
        "c16_reclaim_only_closeout_complete",
        "synthetic_vms_reclaimed",
    ):
        if phase_1b_inputs.get(field) is not True:
            raise Phase1CA0ValidationError(f"{field.upper()}_NOT_CONFIRMED")

    requirements = evidence.get("hard_requirements")
    if not isinstance(requirements, dict):
        raise Phase1CA0ValidationError("HARD_REQUIREMENTS_INVALID")
    expected_true = (
        "native_or_directly_enforceable_deny_by_default_egress_required",
        "per_profile_network_allowlist_required",
        "packet_capture_visibility_not_sufficient",
        "macos_pf_pre_nat_visibility_not_assumed",
        "per_profile_filesystem_boundary_required",
        "separate_profile_auth_store_required",
        "sanitized_subprocess_environment_required",
        "fail_closed_required",
        "default_profile_compatibility_required",
        "secret_free_evidence_required",
    )
    for field in expected_true:
        if requirements.get(field) is not True:
            raise Phase1CA0ValidationError(f"{field.upper()}_MISSING")
    for field in (
        "root_auth_fallback_for_non_default_profiles_allowed",
        "root_credential_pool_materialization_allowed",
    ):
        if requirements.get(field) is not False:
            raise Phase1CA0ValidationError(f"{field.upper()}_UNEXPECTEDLY_ALLOWED")

    candidates = evidence.get("candidate_classes")
    if not isinstance(candidates, dict):
        raise Phase1CA0ValidationError("CANDIDATE_CLASSES_INVALID")
    if candidates.get("lima_vz_standalone_backend") != "REJECTED_FOR_PROFILE_RUNTIME":
        raise Phase1CA0ValidationError("LIMA_VZ_REJECTION_MISSING")
    if candidates.get("macos_container_runtime_with_opaque_nat") != "REJECT_UNLESS_NATIVE_POLICY_PROVEN":
        raise Phase1CA0ValidationError("OPAQUE_NAT_POLICY_GATE_MISSING")

    forbidden = evidence.get("forbidden_in_a0")
    if not isinstance(forbidden, dict):
        raise Phase1CA0ValidationError("FORBIDDEN_IN_A0_INVALID")
    for field, value in forbidden.items():
        if value is not False:
            raise Phase1CA0ValidationError(f"{field.upper()}_UNEXPECTEDLY_PERFORMED")

    next_gates = evidence.get("next_gates")
    expected_next = [
        "PHASE_1C_A1_BACKEND_CAPABILITY_MATRIX",
        "PHASE_1C_A2_PROFILE_RUNTIME_THREAT_MODEL",
        "PHASE_1C_A3_ISOLATION_PROOF_CONTRACT",
        "PHASE_1C_A4_OWNER_APPROVAL_PACKET",
    ]
    if next_gates != expected_next:
        raise Phase1CA0ValidationError("NEXT_GATES_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "phase_result": EXPECTED_RESULT,
        "lima_vz_standalone_backend": "REJECTED_FOR_PROFILE_RUNTIME",
        "implementation_ready": False,
        "next_gate": expected_next[0],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-evidence"])
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-evidence":
            _json_print(validate_evidence(args.evidence))
            return 0
    except (Phase1CA0ValidationError, json.JSONDecodeError) as error:
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
