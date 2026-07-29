"""Disabled-by-default host runtime wiring contracts for Phase 1E.

This module prepares a secret-free host runtime wiring manifest from local
contract objects only. It does not import Hermes runtime code, mutate gateway
state, wire gateway handlers, start runtime processes, start subprocesses,
create sandboxes, call provider/model APIs, read process environment, read auth
files, access Keychain, change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_runtime_execution_contracts import (
    HostRuntimeExecutionConfig,
    HostRuntimeExecutionDecision,
    HostRuntimeExecutionRequest,
    prepare_host_runtime_execution,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_WIRING_CAPABILITIES = frozenset(
    {
        "host_runtime_execution_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "no_gateway_mutation",
        "no_process_launch",
    }
)


@dataclass(frozen=True)
class HostRuntimeWiringIdentity:
    wiring_name: str
    wiring_version: str
    wiring_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class HostRuntimeWiringConfig:
    """Disabled-by-default host runtime wiring controls."""

    wiring_contract_enabled: bool = False
    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    gateway_wiring_enabled: bool = False
    hermes_core_wiring_enabled: bool = False
    dependency_changes_enabled: bool = False
    runtime_process_launch_enabled: bool = False
    subprocess_launch_enabled: bool = False
    sandbox_creation_enabled: bool = False
    provider_model_api_enabled: bool = False
    credential_materialization_enabled: bool = False


@dataclass(frozen=True)
class HostRuntimeWiringRequest:
    wiring_identity: HostRuntimeWiringIdentity
    execution_request: HostRuntimeExecutionRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str
    wiring_policy_id: str


@dataclass(frozen=True)
class HostRuntimeWiringDecision:
    allowed: bool
    reason: str
    execution_decision: HostRuntimeExecutionDecision | None = None
    wiring_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_host_runtime_wiring(
    *,
    request: HostRuntimeWiringRequest,
    config: HostRuntimeWiringConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> HostRuntimeWiringDecision:
    """Prepare host runtime wiring manifest without wiring or starting runtime."""

    resolved_config = config or HostRuntimeWiringConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _wiring_identity_reason(request.wiring_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    execution_decision = prepare_host_runtime_execution(
        request=request.execution_request,
        config=HostRuntimeExecutionConfig(
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_process_launch_enabled=resolved_config.runtime_process_launch_enabled,
            subprocess_launch_enabled=resolved_config.subprocess_launch_enabled,
            sandbox_creation_enabled=resolved_config.sandbox_creation_enabled,
            provider_model_api_enabled=resolved_config.provider_model_api_enabled,
            credential_materialization_enabled=resolved_config.credential_materialization_enabled,
            gateway_integration_enabled=resolved_config.gateway_wiring_enabled,
            hermes_core_integration_enabled=resolved_config.hermes_core_wiring_enabled,
            dependency_changes_enabled=resolved_config.dependency_changes_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if execution_decision.reason != "HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED":
        return HostRuntimeWiringDecision(False, execution_decision.reason, execution_decision)

    execution_manifest = execution_decision.execution_manifest or {}
    wiring_manifest = {
        "wiring_name": request.wiring_identity.wiring_name,
        "wiring_version": request.wiring_identity.wiring_version,
        "wiring_contract_version": request.wiring_identity.wiring_contract_version,
        "executor_name": execution_manifest["executor_name"],
        "host_adapter_name": execution_manifest["host_adapter_name"],
        "adapter_name": execution_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "wiring_policy_id": request.wiring_policy_id,
        "wiring_state": "disabled_contract_ready_no_gateway_wired",
    }
    scan = scan_secret_shapes(wiring_manifest)
    if not scan.allowed:
        return HostRuntimeWiringDecision(False, "WIRING_MANIFEST_SECRET_SCAN_FAILED", execution_decision)
    return HostRuntimeWiringDecision(
        allowed=False,
        reason="HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED",
        execution_decision=execution_decision,
        wiring_manifest=wiring_manifest,
    )


def _config_denial_reason(config: HostRuntimeWiringConfig) -> str | None:
    if not config.wiring_contract_enabled:
        return "HOST_RUNTIME_WIRING_DISABLED"
    if config.gateway_wiring_enabled:
        return "GATEWAY_WIRING_OUT_OF_SCOPE"
    if config.hermes_core_wiring_enabled:
        return "HERMES_CORE_WIRING_OUT_OF_SCOPE"
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


def _wiring_identity_reason(identity: HostRuntimeWiringIdentity) -> str | None:
    for field, value in (
        ("wiring_name", identity.wiring_name),
        ("wiring_version", identity.wiring_version),
        ("wiring_contract_version", identity.wiring_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"WIRING_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_WIRING_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"WIRING_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: HostRuntimeWiringRequest) -> str | None:
    if request.expected_profile_id != request.execution_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != request.execution_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != request.execution_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != request.execution_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if not isinstance(request.wiring_policy_id, str) or not request.wiring_policy_id.strip():
        return "WIRING_POLICY_MISSING"
    return None


def _deny(reason: str) -> HostRuntimeWiringDecision:
    return HostRuntimeWiringDecision(False, reason)
