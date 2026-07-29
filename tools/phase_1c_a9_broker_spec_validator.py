#!/usr/bin/env python3
"""Validate the Phase 1C-A9 host-side model and credential broker spec.

This validator is read-only. It does not call providers, start sandboxes,
restart gateways, run profiles, read credentials, or change runtime state.
"""

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


DEFAULT_SPEC = PROJECT_ROOT / "security/evidence/phase-1c-a9/host-side-model-and-credential-broker-spec.json"
EXPECTED_SCHEMA = "pankster.phase1c-a9.host-side-broker-spec.v1"
EXPECTED_CONTENT_SHA = "c24d2b25bde9ec7c84126cbb37e88a2cfbffc0dceca2a534d83230d2dd42a469"
EXPECTED_A8_EVIDENCE = PROJECT_ROOT / "security/evidence/phase-1c-a8/production-readiness-static-closeout.json"
EXPECTED_A8_EVIDENCE_SHA = "e90188b4cbdaf74f2d5eb8c6bfb50dcac47bb39b1a825646ca28fb00b0919aa5"
EXPECTED_A8_CONTENT_SHA = "672d87fd9546879dcff960d7b6cc8f074ac35b5da20d314c96cc394545750bfb"
EXPECTED_A8_STATUS = "READY_FOR_ARCHITECTURE_DESIGN_NEXT_NOT_PRODUCTION_DEPLOYMENT"
EXPECTED_DECISION = "HOST_SIDE_MODEL_AND_CREDENTIAL_BROKER_REQUIRED_BEFORE_PRODUCTION_RUNTIME"


class Phase1CA9ValidationError(RuntimeError):
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
        raise Phase1CA9ValidationError(missing_reason, str(path)) from error
    except json.JSONDecodeError as error:
        raise Phase1CA9ValidationError("INVALID_JSON", str(error)) from error
    if not isinstance(payload, dict):
        raise Phase1CA9ValidationError("JSON_NOT_OBJECT", str(path))
    return payload


def _sha256_file(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError as error:
        raise Phase1CA9ValidationError("SOURCE_A8_EVIDENCE_MISSING", str(path)) from error


def _expect_subset(values: object, expected: set[str], reason: str) -> None:
    if not isinstance(values, list):
        raise Phase1CA9ValidationError(reason, "not a list")
    missing = sorted(expected - set(values))
    if missing:
        raise Phase1CA9ValidationError(reason, ",".join(missing))


def _expect_bool_false(content: dict, field: str) -> None:
    if content.get(field) is not False:
        raise Phase1CA9ValidationError(f"{field.upper()}_NOT_FALSE")


def _validate_a8_evidence() -> dict:
    if _sha256_file(EXPECTED_A8_EVIDENCE) != EXPECTED_A8_EVIDENCE_SHA:
        raise Phase1CA9ValidationError("SOURCE_A8_EVIDENCE_SHA_MISMATCH")
    evidence = _load_json(EXPECTED_A8_EVIDENCE, "SOURCE_A8_EVIDENCE_MISSING")
    if evidence.get("content_sha256") != EXPECTED_A8_CONTENT_SHA:
        raise Phase1CA9ValidationError("SOURCE_A8_CONTENT_SHA_UNEXPECTED")
    content = evidence.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA9ValidationError("SOURCE_A8_CONTENT_INVALID")
    if content.get("final_status") != EXPECTED_A8_STATUS:
        raise Phase1CA9ValidationError("SOURCE_A8_STATUS_INVALID")
    if content.get("decision") != "SYNTHETIC_E2B_ISOLATION_PROOF_PASSED_PRODUCTION_NOT_APPROVED":
        raise Phase1CA9ValidationError("SOURCE_A8_DECISION_INVALID")
    not_approved = content.get("not_approved_capabilities")
    if not isinstance(not_approved, dict):
        raise Phase1CA9ValidationError("SOURCE_A8_NOT_APPROVED_INVALID")
    for field in (
        "production_profile_execution",
        "real_model_credentials_in_sandbox",
        "root_auth_json_fallback",
        "gateway_runtime_change",
        "oauth_refresh_or_credential_write",
    ):
        if not_approved.get(field) is not True:
            raise Phase1CA9ValidationError("SOURCE_A8_PRODUCTION_NOT_BLOCKED", field)
    return content


def _validate_components(components: object) -> None:
    if not isinstance(components, dict):
        raise Phase1CA9ValidationError("COMPONENTS_INVALID")
    required = {
        "policy_engine",
        "credential_broker",
        "grant_registry",
        "model_broker",
        "runtime_adapter_interface",
        "audit_sink",
    }
    if set(components) != required:
        raise Phase1CA9ValidationError("COMPONENT_SET_INVALID", ",".join(sorted(required - set(components))))
    credential_broker = components["credential_broker"]
    if credential_broker.get("can_refresh_oauth") is not True:
        raise Phase1CA9ValidationError("CREDENTIAL_BROKER_OAUTH_REFRESH_NOT_EXPLICIT")
    if credential_broker.get("oauth_refresh_policy") != "owner_only_compare_and_swap_no_profile_write":
        raise Phase1CA9ValidationError("OAUTH_REFRESH_POLICY_INVALID")
    if components["model_broker"].get("runs_inside_sandbox") is not False:
        raise Phase1CA9ValidationError("MODEL_BROKER_NOT_HOST_SIDE")
    if components["runtime_adapter_interface"].get("implementation_in_a9") is not False:
        raise Phase1CA9ValidationError("RUNTIME_ADAPTER_IMPLEMENTATION_APPROVED")
    if components["audit_sink"].get("secret_values_allowed") is not False:
        raise Phase1CA9ValidationError("AUDIT_SINK_ALLOWS_SECRETS")


def _validate_grant_contract(grant: object) -> None:
    if not isinstance(grant, dict):
        raise Phase1CA9ValidationError("GRANT_CONTRACT_INVALID")
    _expect_subset(
        grant.get("required_fields"),
        {
            "principal_id",
            "profile_id",
            "workflow_id",
            "task_id",
            "attempt_id",
            "purpose",
            "provider_family",
            "model_allowlist",
            "operation_allowlist",
            "ttl_seconds",
            "budget",
            "policy_version",
            "runtime_identity_hash",
            "network_policy_id",
        },
        "GRANT_REQUIRED_FIELDS_INCOMPLETE",
    )
    _expect_subset(
        grant.get("forbidden_fields"),
        {
            "api_key",
            "access_token",
            "refresh_token",
            "authorization_header",
            "provider_secret_value",
            "root_auth_json_path",
            "root_credential_pool",
        },
        "GRANT_FORBIDDEN_FIELDS_INCOMPLETE",
    )
    if grant.get("grant_reference_format") != "grant_opaque_<uuid4_hex>":
        raise Phase1CA9ValidationError("GRANT_REFERENCE_FORMAT_INVALID")
    if grant.get("grant_reference_is_bearer_secret") is not False:
        raise Phase1CA9ValidationError("GRANT_REFERENCE_IS_BEARER_SECRET")
    if grant.get("ttl_max_seconds") != 900:
        raise Phase1CA9ValidationError("GRANT_TTL_INVALID")
    for field in ("requires_runtime_identity_binding", "requires_attempt_binding", "requires_policy_version_binding", "revocable"):
        if grant.get(field) is not True:
            raise Phase1CA9ValidationError(f"GRANT_{field.upper()}_INVALID")


def _validate_model_broker_contract(contract: object) -> None:
    if not isinstance(contract, dict):
        raise Phase1CA9ValidationError("MODEL_BROKER_CONTRACT_INVALID")
    _expect_subset(
        contract.get("request_required_fields"),
        {
            "grant_id",
            "attempt_id",
            "sequence_id",
            "provider_family",
            "model",
            "operation",
            "input_artifact_ref_or_payload_hash",
            "idempotency_key",
        },
        "MODEL_REQUEST_REQUIRED_FIELDS_INCOMPLETE",
    )
    _expect_subset(
        contract.get("request_forbidden_fields"),
        {
            "api_key",
            "access_token",
            "authorization_header",
            "raw_provider_credentials",
            "root_auth_json",
            "root_credential_pool",
        },
        "MODEL_REQUEST_FORBIDDEN_FIELDS_INCOMPLETE",
    )
    _expect_subset(
        contract.get("response_forbidden_fields"),
        {
            "provider_secret_value",
            "authorization_header",
            "raw_request_headers",
            "raw_response_headers",
        },
        "MODEL_RESPONSE_FORBIDDEN_FIELDS_INCOMPLETE",
    )
    for field in ("idempotency_required", "budget_enforced_before_provider_call", "model_allowlist_enforced_before_provider_call"):
        if contract.get(field) is not True:
            raise Phase1CA9ValidationError(f"MODEL_{field.upper()}_INVALID")


def _validate_sandbox_runtime(contract: object) -> None:
    if not isinstance(contract, dict):
        raise Phase1CA9ValidationError("SANDBOX_RUNTIME_CONTRACT_INVALID")
    _expect_subset(
        contract.get("environment_allowlist"),
        {
            "PATH",
            "HOME",
            "TMPDIR",
            "LANG",
            "SHELL",
            "NO_PROXY",
            "no_proxy",
            "PANKSTER_PROFILE_ID",
            "PANKSTER_ATTEMPT_ID",
            "PANKSTER_GRANT_IDS",
            "PANKSTER_POLICY_VERSION",
        },
        "SANDBOX_ENV_ALLOWLIST_INCOMPLETE",
    )
    _expect_subset(
        contract.get("mandatory_env_denylist"),
        {
            "*_KEY",
            "*_TOKEN",
            "*_SECRET",
            "*_PASSWORD",
            "AUTHORIZATION",
            "ANTHROPIC_*",
            "OPENAI_*",
            "GLM_*",
            "GITEA_*",
            "SUPABASE_*",
            "TELEGRAM_*",
            "E2B_API_KEY",
        },
        "SANDBOX_ENV_DENYLIST_INCOMPLETE",
    )
    for field in (
        "root_auth_fallback_allowed",
        "root_credential_pool_materialization_allowed",
        "real_model_credentials_in_sandbox_allowed",
    ):
        if contract.get(field) is not False:
            raise Phase1CA9ValidationError(f"{field.upper()}_NOT_FALSE")
    if "not_approved_in_a9" not in str(contract.get("network_policy", "")):
        raise Phase1CA9ValidationError("SANDBOX_NETWORK_POLICY_TOO_BROAD")


def _validate_required_tests(required_tests: object) -> None:
    if not isinstance(required_tests, dict):
        raise Phase1CA9ValidationError("REQUIRED_TESTS_INVALID")
    _expect_subset(
        required_tests.get("unit"),
        {
            "grant_schema_rejects_secret_fields",
            "grant_reference_not_bearer_without_runtime_identity",
            "policy_missing_fails_closed",
            "model_allowlist_enforced_before_provider_call",
            "budget_enforced_before_provider_call",
            "oauth_refresh_owner_only_cas",
            "audit_event_contains_no_secret_values",
            "sandbox_env_allowlist_denylist_enforced",
        },
        "UNIT_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("integration_synthetic"),
        {
            "sandbox_receives_only_grant_reference_and_policy_ids",
            "fake_model_broker_returns_response_without_provider_key",
            "sandbox_cannot_call_provider_directly_with_deny_all",
            "retry_reclaim_preserves_grant_attempt_binding",
            "expired_grant_blocks_replay",
        },
        "INTEGRATION_TESTS_INCOMPLETE",
    )
    _expect_subset(
        required_tests.get("security"),
        {
            "argv_logs_evidence_secret_scan",
            "root_auth_fallback_disabled_for_named_profiles",
            "root_pool_materialization_forbidden",
            "mcp_terminal_code_delegation_children_do_not_receive_provider_credentials",
        },
        "SECURITY_TESTS_INCOMPLETE",
    )


def validate_spec(path: Path = DEFAULT_SPEC) -> dict:
    spec = _load_json(path, "SPEC_MISSING")
    if spec.get("schema_version") != EXPECTED_SCHEMA:
        raise Phase1CA9ValidationError("SCHEMA_INVALID")
    content = spec.get("decision_content")
    if not isinstance(content, dict):
        raise Phase1CA9ValidationError("DECISION_CONTENT_INVALID")
    if spec.get("content_sha256") != EXPECTED_CONTENT_SHA:
        raise Phase1CA9ValidationError("CONTENT_SHA_UNEXPECTED")
    if hashlib.sha256(canonical_json_bytes(content)).hexdigest() != EXPECTED_CONTENT_SHA:
        raise Phase1CA9ValidationError("CONTENT_SHA_MISMATCH")

    _validate_a8_evidence()
    source = content.get("source_evidence")
    if not isinstance(source, dict):
        raise Phase1CA9ValidationError("SOURCE_EVIDENCE_INVALID")
    if source.get("a8_closeout_file_sha256") != EXPECTED_A8_EVIDENCE_SHA:
        raise Phase1CA9ValidationError("A9_SOURCE_A8_FILE_SHA_INVALID")
    if source.get("a8_decision_content_sha256") != EXPECTED_A8_CONTENT_SHA:
        raise Phase1CA9ValidationError("A9_SOURCE_A8_CONTENT_SHA_INVALID")

    if content.get("status") != "SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVED":
        raise Phase1CA9ValidationError("STATUS_INVALID")
    if content.get("decision") != EXPECTED_DECISION:
        raise Phase1CA9ValidationError("DECISION_INVALID")
    for field in ("implementation_approved", "production_profiles_approved", "provider_api_calls_approved", "sandbox_execution_approved"):
        _expect_bool_false(content, field)

    _expect_subset(
        content.get("design_principles"),
        {
            "host_retains_all_real_credentials",
            "sandbox_receives_no_provider_secret_values",
            "grant_references_are_not_bearer_secrets",
            "model_calls_are_host_orchestrated",
            "missing_invalid_policy_fails_closed",
        },
        "DESIGN_PRINCIPLES_INCOMPLETE",
    )
    _validate_components(content.get("components"))
    _validate_grant_contract(content.get("grant_contract"))
    _validate_model_broker_contract(content.get("model_broker_contract"))
    _validate_sandbox_runtime(content.get("sandbox_runtime_contract"))
    _expect_subset(
        content.get("fail_closed_cases"),
        {
            "missing_profile_policy",
            "invalid_policy_version",
            "expired_grant",
            "grant_attempt_mismatch",
            "grant_replay_detected",
            "model_not_allowlisted",
            "operation_not_allowlisted",
            "budget_exceeded",
            "broker_unavailable",
            "oauth_refresh_conflict",
            "audit_sink_unavailable",
        },
        "FAIL_CLOSED_CASES_INCOMPLETE",
    )
    _validate_required_tests(content.get("required_tests"))
    if content.get("next_gate") != "A10_RUNTIME_ADAPTER_DESIGN_REVIEW":
        raise Phase1CA9ValidationError("NEXT_GATE_INVALID")

    return {
        "result": "PASS",
        "mode": "validate-spec",
        "decision": EXPECTED_DECISION,
        "status": content["status"],
        "content_sha256": EXPECTED_CONTENT_SHA,
        "production_approved": False,
        "implementation_approved": False,
        "next_gate": content["next_gate"],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["validate-spec"])
    parser.add_argument("--spec", type=Path, default=DEFAULT_SPEC)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "validate-spec":
            _json_print(validate_spec(args.spec))
            return 0
    except (Phase1CA9ValidationError, json.JSONDecodeError) as error:
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
