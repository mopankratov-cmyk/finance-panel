#!/usr/bin/env python3
"""Execute the Phase 1D-A10 approved synthetic runner preflight dry-run.

This executor is intentionally local and in-process. It performs no sandbox
creation, subprocess launch, provider/model API call, credential read, auth file
read, Keychain read, gateway/profile/canary change, dependency operation, or
OAuth refresh. The output manifest is sanitized and synthetic-only.
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

from tools.pankster_runtime_security.environment_sanitizer import sanitize_environment
from tools.pankster_runtime_security.fake_grants import FakeGrantRegistry
from tools.pankster_runtime_security.fake_model_broker import FakeModelBroker, FakeModelRequest
from tools.pankster_runtime_security.policy_schema import validate_profile_policy
from tools.pankster_runtime_security.runtime_adapter_contracts import (
    BrokerForwardRequest,
    RuntimeAdapterConfig,
    RuntimeAdapterStub,
    RuntimeLaunchRequest,
    RuntimeSecurityContext,
)
from tools.phase_1d_a9_synthetic_runner_approval_request_validator import (
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    EXPECTED_CONTENT_SHA as EXPECTED_A9_CONTENT_SHA,
    validate_evidence as validate_a9_evidence,
)


DEFAULT_MANIFEST_OUTPUT = PROJECT_ROOT / "security/evidence/phase-1d-a10/synthetic-runner-preflight-execution.json"
SCHEMA_VERSION = "pankster.phase1d-a10.synthetic-runner-preflight-execution.v1"


class Phase1DA10ExecutionError(RuntimeError):
    def __init__(self, reason: str, detail: object | None = None):
        self.reason = reason
        self.detail = detail
        super().__init__(reason if detail is None else f"{reason}: {detail}")


def _json_print(payload: dict) -> None:
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def validate_owner_approval(approval_command: str) -> None:
    if approval_command != EXPECTED_APPROVAL:
        raise Phase1DA10ExecutionError("OWNER_APPROVAL_COMMAND_MISMATCH")
    if hashlib.sha256(approval_command.encode("utf-8")).hexdigest() != EXPECTED_APPROVAL_SHA:
        raise Phase1DA10ExecutionError("OWNER_APPROVAL_COMMAND_SHA_MISMATCH")


def synthetic_policy() -> dict:
    return {
        "profile_id": "synthetic-profile",
        "enabled": True,
        "owner_principal_id": "synthetic-owner",
        "policy_version": "policy-v1",
        "runtime_backend": "synthetic-local-dry-run",
        "network_policy_id": "deny-all",
        "model_provider_allowlist": ["fake-provider"],
        "model_allowlist": ["fake-model"],
        "operation_allowlist": ["model.complete"],
        "grant_ttl_seconds_max": 60,
        "budget": {
            "max_usd_per_attempt": 0,
            "max_tokens_per_attempt": 0,
            "max_requests_per_attempt": 2,
            "max_wall_clock_seconds": 30,
            "max_retries": 0,
        },
        "rate_limits": {},
        "credential_reference_allowlist": ["synthetic-credential-reference"],
        "environment_policy_id": "environment-policy-v1",
        "artifact_policy_id": "artifact-policy-v1",
        "audit_policy_id": "audit-policy-v1",
        "rollback_policy_id": "rollback-policy-v1",
    }


def execute_preflight(approval_command: str, *, manifest_output: Path | None = DEFAULT_MANIFEST_OUTPUT) -> dict:
    validate_a9_evidence()
    validate_owner_approval(approval_command)

    policy_result = validate_profile_policy(synthetic_policy())
    if not policy_result.allowed:
        raise Phase1DA10ExecutionError("SYNTHETIC_POLICY_INVALID", policy_result.reasons)

    registry = FakeGrantRegistry()
    grant_decision = registry.issue_grant(
        profile_id="synthetic-profile",
        workflow_id="workflow-1",
        task_id="task-1",
        attempt_id="attempt-1",
        purpose="model",
        provider_family="fake-provider",
        model_allowlist=("fake-model",),
        operation_allowlist=("model.complete",),
        ttl_seconds=60,
        budget_requests=2,
        policy_version="policy-v1",
        runtime_identity_hash="runtime-hash",
        network_policy_id="deny-all",
    )
    if not grant_decision.allowed or grant_decision.grant is None:
        raise Phase1DA10ExecutionError("SYNTHETIC_GRANT_ISSUE_FAILED", grant_decision.reason)
    grant = grant_decision.grant

    broker = FakeModelBroker(registry)
    request = FakeModelRequest(
        grant_id=grant.grant_id,
        profile_id="synthetic-profile",
        task_id="task-1",
        attempt_id="attempt-1",
        runtime_identity_hash="runtime-hash",
        provider_family="fake-provider",
        model="fake-model",
        operation="model.complete",
        sequence_id="seq-1",
        input_payload_hash="abc123def4567890",
    )
    broker_response = broker.complete(request)
    replay_response = broker.complete(request)
    if not broker_response.allowed:
        raise Phase1DA10ExecutionError("SYNTHETIC_BROKER_COMPLETION_FAILED", broker_response.reason)
    if replay_response.allowed or replay_response.reason != "GRANT_REPLAY_DETECTED":
        raise Phase1DA10ExecutionError("SYNTHETIC_REPLAY_NOT_DENIED", replay_response.reason)

    runtime_context = RuntimeSecurityContext(
        profile_id="synthetic-profile",
        workflow_id="workflow-1",
        task_id="task-1",
        attempt_id="attempt-1",
        policy_version="policy-v1",
        runtime_identity_hash="runtime-hash",
        network_policy_id="deny-all",
        grant_ids=(grant.grant_id,),
    )
    default_adapter_decision = RuntimeAdapterStub().prepare_launch(
        RuntimeLaunchRequest(
            context=runtime_context,
            source_environment={"PATH": "/usr/bin"},
            command=("synthetic-runner",),
        )
    )
    enabled_adapter = RuntimeAdapterStub(RuntimeAdapterConfig(adapter_enabled=True, broker_channel_enabled=True, sandbox_launch_enabled=True))
    enabled_adapter_decision = enabled_adapter.prepare_launch(
        RuntimeLaunchRequest(
            context=runtime_context,
            source_environment={
                "PATH": "/usr/bin",
                "NO_PROXY": "localhost,127.0.0.1",
                "no_proxy": "localhost,127.0.0.1",
                "OPENAI_API_KEY": "synthetic-redacted",
                "TELEGRAM_BOT_TOKEN": "synthetic-redacted",
                "UNDECLARED": "ignored",
            },
            command=("synthetic-runner",),
        )
    )
    broker_forward_decision = enabled_adapter.forward_to_broker(
        BrokerForwardRequest(
            context=runtime_context,
            grant_id=grant.grant_id,
            operation="model.complete",
            sequence_id="seq-forward",
            payload_hash="abc123",
        )
    )
    missing_grant_decision = enabled_adapter.forward_to_broker(
        BrokerForwardRequest(
            context=runtime_context,
            grant_id="grant_opaque_not_bound",
            operation="model.complete",
            sequence_id="seq-missing-grant",
            payload_hash="abc123",
        )
    )
    direct_sanitizer = sanitize_environment(
        {
            "PATH": "/usr/bin",
            "NO_PROXY": "localhost",
            "OPENAI_API_KEY": "synthetic-redacted",
            "SUPABASE_SERVICE_ROLE_KEY": "synthetic-redacted",
        }
    )

    proofs = {
        "a9_evidence_verified": True,
        "approval_command_verified": True,
        "synthetic_policy_validated": policy_result.allowed,
        "fake_grant_issued_without_secret": grant.grant_id.startswith("grant_opaque_"),
        "fake_model_broker_completed_synthetic_response": broker_response.allowed and broker_response.reason == "FAKE_MODEL_COMPLETED",
        "fake_model_broker_replay_denied": replay_response.reason == "GRANT_REPLAY_DETECTED",
        "default_runtime_adapter_denied": default_adapter_decision.reason == "RUNTIME_ADAPTER_DISABLED",
        "enabled_runtime_adapter_sanitized_environment": enabled_adapter_decision.reason == "SANDBOX_LAUNCH_NOT_IMPLEMENTED",
        "enabled_runtime_adapter_preserved_no_proxy": enabled_adapter_decision.sanitized_environment.env.get("NO_PROXY") == "localhost,127.0.0.1"
        and enabled_adapter_decision.sanitized_environment.env.get("no_proxy") == "localhost,127.0.0.1",
        "enabled_runtime_adapter_denied_sensitive_keys": set(enabled_adapter_decision.sanitized_environment.denied_keys) == {"OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN"},
        "broker_channel_stub_denied": broker_forward_decision.reason == "BROKER_CHANNEL_NOT_IMPLEMENTED",
        "unbound_grant_denied_before_broker_stub": missing_grant_decision.reason == "GRANT_NOT_BOUND_TO_CONTEXT",
        "direct_sanitizer_denied_sensitive_keys": set(direct_sanitizer.denied_keys) == {"OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"},
        "no_sandbox_started": not enabled_adapter_decision.sandbox_started,
        "no_broker_channel_started": not broker_forward_decision.broker_channel_started,
    }
    failed = sorted(key for key, value in proofs.items() if value is not True)
    if failed:
        raise Phase1DA10ExecutionError("SYNTHETIC_PREFLIGHT_PROOF_FAILED", failed)

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "result": "PASS",
        "mode": "execute-preflight",
        "contract_content_sha256": "3a8b46a0703110942ce1733961c945746abb8ada04c1bde206f8a070c5182932",
        "a9_content_sha256": EXPECTED_A9_CONTENT_SHA,
        "approval_command_sha256": EXPECTED_APPROVAL_SHA,
        "synthetic_only": True,
        "local_dry_run_only": True,
        "provider_api_calls_performed": False,
        "model_api_calls_performed": False,
        "real_credentials_used": False,
        "auth_files_read": False,
        "keychain_read": False,
        "sandbox_created": False,
        "subprocess_launch_performed": False,
        "gateway_changed": False,
        "profile_started": False,
        "canary_started": False,
        "dependency_changes_performed": False,
        "oauth_refresh_performed": False,
        "provider_credential_value_printed": False,
        "sanitized": True,
        "proofs": proofs,
        "sanitized_result": {
            "grant_id_prefix": "grant_opaque_",
            "grant_id_length": len(grant.grant_id),
            "broker_result_reason": broker_response.reason,
            "replay_denial_reason": replay_response.reason,
            "default_adapter_denial_reason": default_adapter_decision.reason,
            "enabled_adapter_denial_reason": enabled_adapter_decision.reason,
            "broker_channel_denial_reason": broker_forward_decision.reason,
            "unbound_grant_denial_reason": missing_grant_decision.reason,
            "sanitized_env_keys": sorted(enabled_adapter_decision.sanitized_environment.env),
            "denied_key_names": sorted(enabled_adapter_decision.sanitized_environment.denied_keys),
            "ignored_key_names": sorted(enabled_adapter_decision.sanitized_environment.ignored_keys),
        },
    }
    if manifest_output is not None:
        manifest_output.parent.mkdir(parents=True, exist_ok=True)
        manifest_output.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["execute-preflight"])
    parser.add_argument("--approval-command", required=True)
    parser.add_argument("--manifest-output", type=Path, default=DEFAULT_MANIFEST_OUTPUT)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.mode == "execute-preflight":
            _json_print(execute_preflight(args.approval_command, manifest_output=args.manifest_output))
            return 0
    except Phase1DA10ExecutionError as error:
        payload = {
            "result": "DENIED",
            "mode": args.mode,
            "reason": error.reason,
            "provider_api_calls_performed": False,
            "model_api_calls_performed": False,
            "real_credentials_used": False,
            "auth_files_read": False,
            "keychain_read": False,
            "sandbox_created": False,
            "subprocess_launch_performed": False,
            "gateway_changed": False,
            "profile_started": False,
            "sanitized": True,
        }
        if error.detail is not None:
            payload["detail"] = error.detail
        _json_print(payload)
        return 1
    raise AssertionError(f"unhandled mode: {args.mode}")


if __name__ == "__main__":
    raise SystemExit(main())
