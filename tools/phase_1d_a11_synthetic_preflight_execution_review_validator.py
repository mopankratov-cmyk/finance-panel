#!/usr/bin/env python3
"""Validate the Phase 1D-A11 synthetic preflight execution review."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.validate_installation_manifest import canonical_json_bytes


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a11/synthetic-preflight-execution-review.json"
EXPECTED_SCHEMA = "pankster.phase1d-a11.synthetic-preflight-execution-review.v1"
EXPECTED_CONTENT_SHA = "df6e642748e5e09e8835ade9b805e2de6709a82137be1616cbce4e9653f09186"
EXPECTED_A10_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a10/synthetic-runner-preflight-evidence.json"
EXPECTED_A10_EVIDENCE_SHA = "13ac243a7c865caa1462e38a4ad29d009ca15f3bfdf8e1583f8fe93219fbdaed"
EXPECTED_A10_CONTENT_SHA = "0362ebaa610596dbd9e01db0f4cf20270c08a3543434b907e3d60496fd5cd453"
EXPECTED_MANIFEST = PROJECT_ROOT / "security/evidence/phase-1d-a10/synthetic-runner-preflight-execution.json"
EXPECTED_MANIFEST_SHA = "9fbd66435832ffbd3d054d69f06505bbcef381ae7f7778629be716270baac5f0"
EXPECTED_MANIFEST_CONTENT_SHA = "868e77cd88444906f014b36d258066999fb1f1f1e135149e7fcb4d1583b84c2e"


class Phase1DA11ValidationError(RuntimeError):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def _load_json(path: Path, missing_reason: str) -> dict:
    try:
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except FileNotFoundError as error:
        raise Phase1DA11ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA11ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA11ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA11ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA11ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA11ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA11ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA11ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A10_EVIDENCE) != EXPECTED_A10_EVIDENCE_SHA:
        raise Phase1DA11ValidationError("SOURCE_A10_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A10_EVIDENCE, "SOURCE_A10_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A10_CONTENT_SHA:
        raise Phase1DA11ValidationError("SOURCE_A10_CONTENT_SHA_UNEXPECTED")
    if _sha256_file(EXPECTED_MANIFEST) != EXPECTED_MANIFEST_SHA:
        raise Phase1DA11ValidationError("MANIFEST_SHA_MISMATCH")
    manifest = _load_json(EXPECTED_MANIFEST, "MANIFEST_MISSING")
    if hashlib.sha256(canonical_json_bytes(manifest)).hexdigest() != EXPECTED_MANIFEST_CONTENT_SHA:
        raise Phase1DA11ValidationError("MANIFEST_CONTENT_SHA_MISMATCH")
    if manifest.get("result") != "PASS":
        raise Phase1DA11ValidationError("MANIFEST_RESULT_INVALID")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA11ValidationError(f"{field.upper()}_NOT_FALSE")
    findings = content.get("accepted_findings")
    if not isinstance(findings, dict) or not findings:
        raise Phase1DA11ValidationError("ACCEPTED_FINDINGS_INVALID")
    for field, value in findings.items():
        if value is not True:
            raise Phase1DA11ValidationError("ACCEPTED_FINDING_NOT_TRUE", field)
    if content.get("required_changes") != []:
        raise Phase1DA11ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {}).get("targeted_a11_validator_tests", {})
    if tests.get("result") != "PASS" or tests.get("tests") != 5:
        raise Phase1DA11ValidationError("TARGETED_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A12_RUNTIME_INTEGRATION_SCOPE_DECISION":
        raise Phase1DA11ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "verdict": content["verdict"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "deployment_approved": False,
        "production_approved": False,
        "next_gate": content["next_gate"],
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
    except (Phase1DA11ValidationError, json.JSONDecodeError) as error:
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
