#!/usr/bin/env python3
"""Validate the Phase 1C-A1 backend capability matrix.

This validator is read-only. It does not install providers, call APIs, start
runtimes, read credentials, or perform network probes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MATRIX = PROJECT_ROOT / "security/evidence/phase-1c-a1/backend-capability-matrix.json"
EXPECTED_SCHEMA = "pankster.phase1c-a1.backend-capability-matrix.v1"
EXPECTED_RECOMMENDATION = "SHORTLIST_REMOTE_SANDBOXES_FOR_A2_THREAT_MODEL"


class Phase1CA1ValidationError(RuntimeError):
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
        raise Phase1CA1ValidationError("MATRIX_MISSING", str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA1ValidationError("MATRIX_INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA1ValidationError("MATRIX_NOT_OBJECT")
    return payload


def validate_matrix(path: Path = DEFAULT_MATRIX) -> dict:
    matrix = _load_json(path)
    if matrix.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA1ValidationError("SCHEMA_INVALID")
    if matrix.get("result") != "RESEARCH_COMPLETE_NO_BACKEND_APPROVED":
        raise Phase1CA1ValidationError("RESULT_INVALID")
    if matrix.get("recommendation") != EXPECTED_RECOMMENDATION:
        raise Phase1CA1ValidationError("RECOMMENDATION_INVALID")

    source_policy = matrix.get("source_policy")
    if not isinstance(source_policy, dict):
        raise Phase1CA1ValidationError("SOURCE_POLICY_INVALID")
    if source_policy.get("official_sources_only") is not True:
        raise Phase1CA1ValidationError("OFFICIAL_SOURCES_ONLY_NOT_SET")
    for field in (
        "installs_performed",
        "provider_api_calls_performed",
        "runtime_started",
        "network_probes_performed",
        "credentials_used",
    ):
        if source_policy.get(field) is not False:
            raise Phase1CA1ValidationError(f"{field.upper()}_UNEXPECTEDLY_PERFORMED")

    candidates = matrix.get("candidate_matrix")
    if not isinstance(candidates, dict):
        raise Phase1CA1ValidationError("CANDIDATE_MATRIX_INVALID")
    for candidate in ("modal_sandbox", "e2b_sandbox"):
        payload = candidates.get(candidate)
        if not isinstance(payload, dict):
            raise Phase1CA1ValidationError("SHORTLIST_CANDIDATE_MISSING", candidate)
        if payload.get("disposition") != "SHORTLIST_REMOTE_SANDBOX_A2":
            raise Phase1CA1ValidationError("SHORTLIST_DISPOSITION_INVALID", candidate)
        if payload.get("native_egress_controls_found") is not True:
            raise Phase1CA1ValidationError("SHORTLIST_EGRESS_CONTROLS_MISSING", candidate)
        if payload.get("profile_runtime_approved") is not False:
            raise Phase1CA1ValidationError("PROFILE_RUNTIME_UNEXPECTEDLY_APPROVED", candidate)
        if payload.get("implementation_ready") is not False:
            raise Phase1CA1ValidationError("IMPLEMENTATION_UNEXPECTEDLY_READY", candidate)

    if candidates.get("lima", {}).get("disposition") != "REJECTED_BY_PHASE_1B_FOR_STANDALONE_PROFILE_RUNTIME":
        raise Phase1CA1ValidationError("LIMA_REJECTION_MISSING")
    for candidate in ("apple_container", "colima", "orbstack", "docker_desktop_eci"):
        payload = candidates.get(candidate)
        if not isinstance(payload, dict):
            raise Phase1CA1ValidationError("CANDIDATE_MISSING", candidate)
        if payload.get("implementation_ready") is not False:
            raise Phase1CA1ValidationError("HOLD_CANDIDATE_UNEXPECTEDLY_READY", candidate)
        if payload.get("profile_runtime_approved") is not False:
            raise Phase1CA1ValidationError("HOLD_CANDIDATE_UNEXPECTEDLY_APPROVED", candidate)

    if matrix.get("shortlist") != ["modal_sandbox", "e2b_sandbox"]:
        raise Phase1CA1ValidationError("SHORTLIST_INVALID")
    if matrix.get("next_gate") != "PHASE_1C_A2_PROFILE_RUNTIME_THREAT_MODEL":
        raise Phase1CA1ValidationError("NEXT_GATE_INVALID")

    forbidden = matrix.get("forbidden_in_a1")
    if not isinstance(forbidden, dict):
        raise Phase1CA1ValidationError("FORBIDDEN_IN_A1_INVALID")
    for field, value in forbidden.items():
        if value is not False:
            raise Phase1CA1ValidationError(f"{field.upper()}_UNEXPECTEDLY_PERFORMED")

    return {
        "result": "PASS",
        "mode": "validate-matrix",
        "recommendation": EXPECTED_RECOMMENDATION,
        "shortlist": ["modal_sandbox", "e2b_sandbox"],
        "backend_approved": False,
        "implementation_ready": False,
        "next_gate": "PHASE_1C_A2_PROFILE_RUNTIME_THREAT_MODEL",
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-matrix"])
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-matrix":
            _json_print(validate_matrix(args.matrix))
            return 0
    except (Phase1CA1ValidationError, json.JSONDecodeError) as error:
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
