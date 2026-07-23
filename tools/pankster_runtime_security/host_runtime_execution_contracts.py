"""Disabled-by-default host runtime execution contracts for Phase 1E.

This module prepares a secret-free host runtime execution manifest from local
contract objects only. It does not import Hermes runtime code, mutate gateway
state, start runtime processes, start subprocesses, create sandboxes, call
provider/model APIs, read process environment, read auth files, access
Keychain, change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_adapter_integration_contracts import (
    HostAdapterIntegrationConfig,
    HostAdapterIntegrationDecision,
    HostAdapterIntegrationRequest,
    prepare_host_adapter_integration,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_EXECUTION_CAPABILITIES = frozenset(
    {
        "host_adapter_integration_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "no_process_launch",
    }
)


@dataclass(frozen=True)
class HostRuntimeExecutionIdentity:
    executor_name: str
    executor_version: str
    execution_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class HostRuntimeExecutionConfig:
    """Disabled-by-default host runtime execution controls."""

    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    runtime_process_launch_enabled: bool = False
    subprocess_launch_enabled: bool = False
    sandbox_creation_enabled: bool = False
    provider_model_api_enabled: bool = False
    credential_materialization_enabled: bool = False
    gateway_integration_enabled: bool = False
    hermes_core_integration_enabled: bool = False
    dependency_changes_enabled: bool = False


@dataclass(frozen=True)
class HostRuntimeExecutionRequest:
    execution_identity: HostRuntimeExecutionIdentity
    host_request: HostAdapterIntegrationRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str


@dataclass(frozen=True)
class HostRuntimeExecutionDecision:
    allowed: bool
    reason: str
    host_decision: HostAdapterIntegrationDecision | None = None
    execution_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_host_runtime_execution(
    *,
    request: HostRuntimeExecutionRequest,
    config: HostRuntimeExecutionConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> HostRuntimeExecutionDecision:
    """Prepare host runtime execution manifest without starting runtime."""

    resolved_config = config or HostRuntimeExecutionConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _execution_identity_reason(request.execution_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    host_decision = prepare_host_adapter_integration(
        request=request.host_request,
        config=HostAdapterIntegrationConfig(
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_launch_enabled=resolved_config.runtime_process_launch_enabled,
            gateway_integration_enabled=resolved_config.gateway_integration_enabled,
            hermes_core_integration_enabled=resolved_config.hermes_core_integration_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if host_decision.reason != "HOST_ADAPTER_INTEGRATION_CONTRACT_READY_NO_RUNTIME_INTEGRATED":
        return HostRuntimeExecutionDecision(False, host_decision.reason, host_decision)

    host_manifest = host_decision.host_manifest or {}
    execution_manifest = {
        "executor_name": request.execution_identity.executor_name,
        "executor_version": request.execution_identity.executor_version,
        "execution_contract_version": request.execution_identity.execution_contract_version,
        "host_adapter_name": host_manifest["host_adapter_name"],
        "adapter_name": host_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "execution_state": "disabled_contract_ready_no_runtime_started",
    }
    scan = scan_secret_shapes(execution_manifest)
    if not scan.allowed:
        return HostRuntimeExecutionDecision(False, "EXECUTION_MANIFEST_SECRET_SCAN_FAILED", host_decision)
    return HostRuntimeExecutionDecision(
        allowed=False,
        reason="HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED",
        host_decision=host_decision,
        execution_manifest=execution_manifest,
    )


def _config_denial_reason(config: HostRuntimeExecutionConfig) -> str | None:
    if not config.execution_contract_enabled:
        return "HOST_RUNTIME_EXECUTION_DISABLED"
    if config.gateway_integration_enabled:
        return "GATEWAY_INTEGRATION_OUT_OF_SCOPE"
    if config.hermes_core_integration_enabled:
        return "HERMES_CORE_INTEGRATION_OUT_OF_SCOPE"
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
    return None


def _execution_identity_reason(identity: HostRuntimeExecutionIdentity) -> str | None:
    for field, value in (
        ("executor_name", identity.executor_name),
        ("executor_version", identity.executor_version),
        ("execution_contract_version", identity.execution_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"EXECUTION_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_EXECUTION_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"EXECUTION_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: HostRuntimeExecutionRequest) -> str | None:
    host_context = request.host_request.binding_request.integration_request.context
    if request.expected_profile_id != host_context.profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != host_context.policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != request.host_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != request.host_request.rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    return None


def _deny(reason: str) -> HostRuntimeExecutionDecision:
    return HostRuntimeExecutionDecision(False, reason)
