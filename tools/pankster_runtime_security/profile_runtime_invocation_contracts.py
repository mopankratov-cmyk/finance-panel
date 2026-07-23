"""Disabled-by-default profile runtime invocation contracts for Phase 1E.

This module prepares a secret-free profile runtime invocation manifest from
local contract objects only. It does not import Hermes runtime code, import or
edit gateway.py, import or edit web_server.py, mutate profile worker runtime
state, invoke profiles, execute profile activation, start runtime processes,
start subprocesses, create sandboxes, call provider/model APIs, read process
environment, read auth files, access Keychain, refresh OAuth credentials,
change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.profile_runtime_activation_execution_contracts import (
    ProfileRuntimeActivationExecutionConfig,
    ProfileRuntimeActivationExecutionDecision,
    ProfileRuntimeActivationExecutionRequest,
    prepare_profile_runtime_activation_execution,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_PROFILE_RUNTIME_INVOCATION_CAPABILITIES = frozenset(
    {
        "profile_runtime_activation_execution_contract_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "no_profile_start",
        "no_activation_execution",
        "no_runtime_invocation",
        "no_runtime_process_launch",
        "no_credential_materialization",
    }
)


@dataclass(frozen=True)
class ProfileRuntimeInvocationIdentity:
    invocation_name: str
    invocation_version: str
    invocation_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class ProfileRuntimeInvocationConfig:
    """Disabled-by-default profile runtime invocation controls."""

    profile_runtime_invocation_contract_enabled: bool = False
    profile_runtime_activation_execution_contract_enabled: bool = False
    profile_runtime_activation_contract_enabled: bool = False
    profile_worker_binding_contract_enabled: bool = False
    gateway_binding_contract_enabled: bool = False
    wiring_contract_enabled: bool = False
    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    profile_runtime_invocation_enabled: bool = False
    profile_runtime_activation_execution_enabled: bool = False
    profile_runtime_activation_enabled: bool = False
    profile_worker_runtime_mutation_enabled: bool = False
    profile_start_enabled: bool = False
    gateway_py_binding_enabled: bool = False
    web_server_py_binding_enabled: bool = False
    gateway_runtime_mutation_enabled: bool = False
    hermes_core_binding_enabled: bool = False
    dependency_changes_enabled: bool = False
    runtime_process_launch_enabled: bool = False
    subprocess_launch_enabled: bool = False
    sandbox_creation_enabled: bool = False
    provider_model_api_enabled: bool = False
    credential_materialization_enabled: bool = False
    oauth_refresh_enabled: bool = False


@dataclass(frozen=True)
class ProfileRuntimeInvocationRequest:
    invocation_identity: ProfileRuntimeInvocationIdentity
    profile_runtime_activation_execution_request: ProfileRuntimeActivationExecutionRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str
    expected_wiring_policy_id: str
    expected_gateway_binding_policy_id: str
    expected_profile_worker_binding_policy_id: str
    expected_profile_runtime_activation_policy_id: str
    expected_profile_runtime_activation_execution_policy_id: str
    profile_runtime_invocation_policy_id: str


@dataclass(frozen=True)
class ProfileRuntimeInvocationDecision:
    allowed: bool
    reason: str
    profile_runtime_activation_execution_decision: ProfileRuntimeActivationExecutionDecision | None = None
    profile_runtime_invocation_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    profile_started: bool = False
    activation_executed: bool = False
    invocation_performed: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    oauth_refresh_performed: bool = False
    profile_worker_changed: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_profile_runtime_invocation(
    *,
    request: ProfileRuntimeInvocationRequest,
    config: ProfileRuntimeInvocationConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> ProfileRuntimeInvocationDecision:
    """Prepare invocation manifest without invoking profile runtime."""

    resolved_config = config or ProfileRuntimeInvocationConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _invocation_identity_reason(request.invocation_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    execution_decision = prepare_profile_runtime_activation_execution(
        request=request.profile_runtime_activation_execution_request,
        config=ProfileRuntimeActivationExecutionConfig(
            profile_runtime_activation_execution_contract_enabled=resolved_config.profile_runtime_activation_execution_contract_enabled,
            profile_runtime_activation_contract_enabled=resolved_config.profile_runtime_activation_contract_enabled,
            profile_worker_binding_contract_enabled=resolved_config.profile_worker_binding_contract_enabled,
            gateway_binding_contract_enabled=resolved_config.gateway_binding_contract_enabled,
            wiring_contract_enabled=resolved_config.wiring_contract_enabled,
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            profile_runtime_activation_execution_enabled=resolved_config.profile_runtime_activation_execution_enabled,
            profile_runtime_activation_enabled=resolved_config.profile_runtime_activation_enabled,
            profile_worker_runtime_mutation_enabled=resolved_config.profile_worker_runtime_mutation_enabled,
            profile_start_enabled=resolved_config.profile_start_enabled,
            gateway_py_binding_enabled=resolved_config.gateway_py_binding_enabled,
            web_server_py_binding_enabled=resolved_config.web_server_py_binding_enabled,
            gateway_runtime_mutation_enabled=resolved_config.gateway_runtime_mutation_enabled,
            hermes_core_binding_enabled=resolved_config.hermes_core_binding_enabled,
            dependency_changes_enabled=resolved_config.dependency_changes_enabled,
            runtime_process_launch_enabled=resolved_config.runtime_process_launch_enabled,
            subprocess_launch_enabled=resolved_config.subprocess_launch_enabled,
            sandbox_creation_enabled=resolved_config.sandbox_creation_enabled,
            provider_model_api_enabled=resolved_config.provider_model_api_enabled,
            credential_materialization_enabled=resolved_config.credential_materialization_enabled,
            oauth_refresh_enabled=resolved_config.oauth_refresh_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if execution_decision.reason != "PROFILE_RUNTIME_ACTIVATION_EXECUTION_CONTRACT_READY_NO_ACTIVATION_EXECUTED":
        return ProfileRuntimeInvocationDecision(False, execution_decision.reason, execution_decision)

    execution_manifest = execution_decision.profile_runtime_activation_execution_manifest or {}
    invocation_manifest = {
        "invocation_name": request.invocation_identity.invocation_name,
        "invocation_version": request.invocation_identity.invocation_version,
        "invocation_contract_version": request.invocation_identity.invocation_contract_version,
        "activation_execution_name": execution_manifest["execution_name"],
        "activation_name": execution_manifest["activation_name"],
        "worker_binding_name": execution_manifest["worker_binding_name"],
        "gateway_binding_name": execution_manifest["gateway_binding_name"],
        "wiring_name": execution_manifest["wiring_name"],
        "executor_name": execution_manifest["executor_name"],
        "host_adapter_name": execution_manifest["host_adapter_name"],
        "adapter_name": execution_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "wiring_policy_id": request.expected_wiring_policy_id,
        "gateway_binding_policy_id": request.expected_gateway_binding_policy_id,
        "profile_worker_binding_policy_id": request.expected_profile_worker_binding_policy_id,
        "profile_runtime_activation_policy_id": request.expected_profile_runtime_activation_policy_id,
        "profile_runtime_activation_execution_policy_id": request.expected_profile_runtime_activation_execution_policy_id,
        "profile_runtime_invocation_policy_id": request.profile_runtime_invocation_policy_id,
        "profile_runtime_invocation_state": "disabled_contract_ready_no_runtime_invoked",
    }
    scan = scan_secret_shapes(invocation_manifest)
    if not scan.allowed:
        return ProfileRuntimeInvocationDecision(False, "PROFILE_RUNTIME_INVOCATION_MANIFEST_SECRET_SCAN_FAILED", execution_decision)
    return ProfileRuntimeInvocationDecision(
        allowed=False,
        reason="PROFILE_RUNTIME_INVOCATION_CONTRACT_READY_NO_RUNTIME_INVOKED",
        profile_runtime_activation_execution_decision=execution_decision,
        profile_runtime_invocation_manifest=invocation_manifest,
    )


def _config_denial_reason(config: ProfileRuntimeInvocationConfig) -> str | None:
    if not config.profile_runtime_invocation_contract_enabled:
        return "PROFILE_RUNTIME_INVOCATION_DISABLED"
    if config.profile_runtime_invocation_enabled:
        return "PROFILE_RUNTIME_INVOCATION_OUT_OF_SCOPE"
    if config.profile_runtime_activation_execution_enabled:
        return "PROFILE_RUNTIME_ACTIVATION_EXECUTION_OUT_OF_SCOPE"
    if config.profile_runtime_activation_enabled:
        return "PROFILE_RUNTIME_ACTIVATION_OUT_OF_SCOPE"
    if config.profile_worker_runtime_mutation_enabled:
        return "PROFILE_WORKER_RUNTIME_MUTATION_OUT_OF_SCOPE"
    if config.profile_start_enabled:
        return "PROFILE_START_OUT_OF_SCOPE"
    if config.gateway_py_binding_enabled:
        return "GATEWAY_PY_BINDING_OUT_OF_SCOPE"
    if config.web_server_py_binding_enabled:
        return "WEB_SERVER_PY_BINDING_OUT_OF_SCOPE"
    if config.gateway_runtime_mutation_enabled:
        return "GATEWAY_RUNTIME_MUTATION_OUT_OF_SCOPE"
    if config.hermes_core_binding_enabled:
        return "HERMES_CORE_BINDING_OUT_OF_SCOPE"
    if config.dependency_changes_enabled:
        return "DEPENDENCY_CHANGES_OUT_OF_SCOPE"
    if config.runtime_process_launch_enabled:
        return "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"
    if config.subprocess_launch_enabled:
        return "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"
    if config.sandbox_creation_enabled:
        return "SANDBOX_CREATION_OUT_OF_SCOPE"
    if config.provider_model_api_enabled:
        return "PROVIDER_MODEL_API_OUT_OF_SCOPE"
    if config.credential_materialization_enabled:
        return "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"
    if config.oauth_refresh_enabled:
        return "OAUTH_REFRESH_OUT_OF_SCOPE"
    return None


def _invocation_identity_reason(identity: ProfileRuntimeInvocationIdentity) -> str | None:
    for field, value in (
        ("invocation_name", identity.invocation_name),
        ("invocation_version", identity.invocation_version),
        ("invocation_contract_version", identity.invocation_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"PROFILE_RUNTIME_INVOCATION_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_PROFILE_RUNTIME_INVOCATION_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"PROFILE_RUNTIME_INVOCATION_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: ProfileRuntimeInvocationRequest) -> str | None:
    execution_request = request.profile_runtime_activation_execution_request
    if request.expected_profile_id != execution_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != execution_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != execution_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != execution_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if request.expected_wiring_policy_id != execution_request.expected_wiring_policy_id:
        return "EXPECTED_WIRING_POLICY_MISMATCH"
    if request.expected_gateway_binding_policy_id != execution_request.expected_gateway_binding_policy_id:
        return "EXPECTED_GATEWAY_BINDING_POLICY_MISMATCH"
    if request.expected_profile_worker_binding_policy_id != execution_request.expected_profile_worker_binding_policy_id:
        return "EXPECTED_PROFILE_WORKER_BINDING_POLICY_MISMATCH"
    if request.expected_profile_runtime_activation_policy_id != execution_request.expected_profile_runtime_activation_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_ACTIVATION_POLICY_MISMATCH"
    if request.expected_profile_runtime_activation_execution_policy_id != execution_request.profile_runtime_activation_execution_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_ACTIVATION_EXECUTION_POLICY_MISMATCH"
    if not isinstance(request.profile_runtime_invocation_policy_id, str) or not request.profile_runtime_invocation_policy_id.strip():
        return "PROFILE_RUNTIME_INVOCATION_POLICY_MISSING"
    return None


def _deny(reason: str) -> ProfileRuntimeInvocationDecision:
    return ProfileRuntimeInvocationDecision(False, reason)
