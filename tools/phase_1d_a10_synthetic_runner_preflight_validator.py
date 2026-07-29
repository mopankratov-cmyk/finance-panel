#!/usr/bin/env python3
"""Validate the Phase 1D-A10 synthetic runner preflight execution evidence."""

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


DEFAULT_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a10/synthetic-runner-preflight-evidence.json"
DEFAULT_MANIFEST = PROJECT_ROOT / "security/evidence/phase-1d-a10/synthetic-runner-preflight-execution.json"
EXPECTED_SCHEMA = "pankster.phase1d-a10.synthetic-runner-preflight-evidence.v1"
EXPECTED_CONTENT_SHA = "0362ebaa610596dbd9e01db0f4cf20270c08a3543434b907e3d60496fd5cd453"
EXPECTED_MANIFEST_SCHEMA = "pankster.phase1d-a10.synthetic-runner-preflight-execution.v1"
EXPECTED_MANIFEST_FILE_SHA = "9fbd66435832ffbd3d054d69f06505bbcef381ae7f7778629be716270baac5f0"
EXPECTED_MANIFEST_CONTENT_SHA = "868e77cd88444906f014b36d258066999fb1f1f1e135149e7fcb4d1583b84c2e"
EXPECTED_A9_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1d-a9/synthetic-runner-execution-approval-request.json"
EXPECTED_A9_EVIDENCE_SHA = "d0c76b2b174a8aa717496345f4038f90178803c4a61155c882fafd638a2921a4"
EXPECTED_A9_CONTENT_SHA = "ddaa61a507ffec2412fbe6cd1dc5bff5e326fd0f4a6b39664964b23f032d366d"
EXPECTED_FILE_HASHES = {
    "tools/phase_1d_a10_synthetic_runner_preflight_executor.py": "81b627aee44778859d01eae1f0ad25de5e6b8ac41f0c7b12a2f2f3341f4039f9",
    "tools/tests/test_phase_1d_a10_synthetic_runner_preflight_executor.py": "04ebc121ff3be1df40ed6ab2171d66c9353318c75553e44ebb8ed8a310060569",
}


class Phase1DA10ValidationError(RuntimeError):
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
        raise Phase1DA10ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1DA10ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1DA10ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1DA10ValidationError("FILE_MISSING", str(path)) from error


def validate_evidence(path: Path = DEFAULT_EVIDENCE) -> dict:
    evidence = _load_json(path, "EVIDENCE_MISSING")
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1DA10ValidationError("SCHEMA_INVALID")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1DA10ValidationError("DECISION_CONTENT_INVALID")
    if evidence.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1DA10ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1DA10ValidationError("CONTENT_SHA_MISMATCH")
    if _sha256_file(EXPECTED_A9_EVIDENCE) != EXPECTED_A9_EVIDENCE_SHA:
        raise Phase1DA10ValidationError("SOURCE_A9_EVIDENCE_SHA_MISMATCH")
    source = _load_json(EXPECTED_A9_EVIDENCE, "SOURCE_A9_EVIDENCE_MISSING")
    if source.get("content_sha256") != EXPECTED_A9_CONTENT_SHA:
        raise Phase1DA10ValidationError("SOURCE_A9_CONTENT_SHA_UNEXPECTED")
    if content.get("implemented_files") != EXPECTED_FILE_HASHES:
        raise Phase1DA10ValidationError("IMPLEMENTED_FILE_HASHES_UNEXPECTED")
    for relative_path, expected_hash in EXPECTED_FILE_HASHES.items():
        if _sha256_file(PROJECT_ROOT / relative_path) != expected_hash:
            raise Phase1DA10ValidationError("IMPLEMENTED_FILE_HASH_MISMATCH", relative_path)

    manifest = _load_json(DEFAULT_MANIFEST, "MANIFEST_MISSING")
    if manifest.get("schema_version") != EXPECTED_MANIFEST_SCHEMA:
        raise Phase1DA10ValidationError("MANIFEST_SCHEMA_INVALID")
    if _sha256_file(DEFAULT_MANIFEST) != EXPECTED_MANIFEST_FILE_SHA:
        raise Phase1DA10ValidationError("MANIFEST_FILE_SHA_MISMATCH")
    if hashlib.sha256(canonical_json_bytes(manifest)).hexdigest() != EXPECTED_MANIFEST_CONTENT_SHA:
        raise Phase1DA10ValidationError("MANIFEST_CONTENT_SHA_MISMATCH")
    if manifest.get("result") != "PASS" or manifest.get("mode") != "execute-preflight":
        raise Phase1DA10ValidationError("MANIFEST_RESULT_INVALID")

    for field in ("deployment_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved", "gateway_changes_approved", "dependency_changes_approved"):
        if content.get(field) is not False:
            raise Phase1DA10ValidationError(f"{field.upper()}_NOT_FALSE")
    scope = content.get("execution_scope")
    if not isinstance(scope, dict):
        raise Phase1DA10ValidationError("EXECUTION_SCOPE_INVALID")
    if scope.get("synthetic_only") is not True or scope.get("local_dry_run_only") is not True or scope.get("sanitized") is not True:
        raise Phase1DA10ValidationError("EXECUTION_SCOPE_POSITIVE_INVALID")
    for field, value in scope.items():
        if field not in {"synthetic_only", "local_dry_run_only", "sanitized"} and value is not False:
            raise Phase1DA10ValidationError("EXECUTION_SCOPE_FORBIDDEN_INVALID", field)
    proofs = content.get("proofs_verified")
    if not isinstance(proofs, dict) or not proofs:
        raise Phase1DA10ValidationError("PROOFS_INVALID")
    for field, value in proofs.items():
        if value is not True:
            raise Phase1DA10ValidationError("PROOF_NOT_TRUE", field)
    if content.get("required_changes") != []:
        raise Phase1DA10ValidationError("REQUIRED_CHANGES_NOT_EMPTY")
    tests = content.get("test_results", {})
    if tests.get("targeted_a10_executor_tests", {}).get("result") != "PASS" or tests.get("targeted_a10_executor_tests", {}).get("tests") != 6:
        raise Phase1DA10ValidationError("EXECUTOR_TEST_RESULT_INVALID")
    if tests.get("targeted_a10_validator_tests", {}).get("result") != "PASS" or tests.get("targeted_a10_validator_tests", {}).get("tests") != 5:
        raise Phase1DA10ValidationError("VALIDATOR_TEST_RESULT_INVALID")
    if content.get("next_gate") != "1D-A11_SYNTHETIC_PREFLIGHT_EXECUTION_REVIEW":
        raise Phase1DA10ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-evidence",
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "manifest_content_sha256": EXPECTED_MANIFEST_CONTENT_SHA,
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
    except (Phase1DA10ValidationError, json.JSONDecodeError) as error:
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
