"""Disabled-by-default host adapter integration contracts for Phase 1E.

This module prepares a secret-free host integration manifest from local
contract objects only. It does not import Hermes runtime code, mutate gateway
state, start processes, create sandboxes, call provider/model APIs, read
process environment, read auth files, access Keychain, or materialize
credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_adapter_binding_contracts import (
    RuntimeAdapterBindingConfig,
    RuntimeAdapterBindingDecision,
    RuntimeAdapterBindingRequest,
    prepare_runtime_adapter_binding,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_HOST_CAPABILITIES = frozenset(
    {
        "profile_scoped_runtime_contracts",
        "sanitized_child_environments",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
    }
)


@dataclass(frozen=True)
class HostAdapterIdentity:
    host_adapter_name: str
    host_adapter_version: str
    host_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class HostAdapterIntegrationConfig:
    """Disabled-by-default host integration controls."""

    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    runtime_launch_enabled: bool = False
    gateway_integration_enabled: bool = False
    hermes_core_integration_enabled: bool = False


@dataclass(frozen=True)
class HostAdapterIntegrationRequest:
    host_identity: HostAdapterIdentity
    binding_request: RuntimeAdapterBindingRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    rollback_policy_id: str


@dataclass(frozen=True)
class HostAdapterIntegrationDecision:
    allowed: bool
    reason: str
    binding_decision: RuntimeAdapterBindingDecision | None = None
    host_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_host_adapter_integration(
    *,
    request: HostAdapterIntegrationRequest,
    config: HostAdapterIntegrationConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> HostAdapterIntegrationDecision:
    """Prepare host integration manifest without integrating runtime."""

    resolved_config = config or HostAdapterIntegrationConfig()
    if not resolved_config.host_integration_enabled:
        return _deny("HOST_ADAPTER_INTEGRATION_DISABLED")
    if resolved_config.gateway_integration_enabled:
        return _deny("GATEWAY_INTEGRATION_OUT_OF_SCOPE")
    if resolved_config.hermes_core_integration_enabled:
        return _deny("HERMES_CORE_INTEGRATION_OUT_OF_SCOPE")
    if resolved_config.runtime_launch_enabled:
        return _deny("RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_HOST_INTEGRATION")

    identity_reason = _host_identity_reason(request.host_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    binding_decision = prepare_runtime_adapter_binding(
        request=request.binding_request,
        config=RuntimeAdapterBindingConfig(
            binding_enabled=resolved_config.adapter_binding_enabled,
            integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_launch_enabled=resolved_config.runtime_launch_enabled,
            gateway_binding_enabled=resolved_config.gateway_integration_enabled,
            hermes_core_binding_enabled=resolved_config.hermes_core_integration_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if binding_decision.reason != "RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND":
        return HostAdapterIntegrationDecision(False, binding_decision.reason, binding_decision)

    manifest = {
        "host_adapter_name": request.host_identity.host_adapter_name,
        "host_adapter_version": request.host_identity.host_adapter_version,
        "host_contract_version": request.host_identity.host_contract_version,
        "adapter_name": binding_decision.binding_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.rollback_policy_id,
        "integration_state": "disabled_contract_ready",
    }
    scan = scan_secret_shapes(manifest)
    if not scan.allowed:
        return HostAdapterIntegrationDecision(False, "HOST_MANIFEST_SECRET_SCAN_FAILED", binding_decision)
    return HostAdapterIntegrationDecision(
        allowed=False,
        reason="HOST_ADAPTER_INTEGRATION_CONTRACT_READY_NO_RUNTIME_INTEGRATED",
        binding_decision=binding_decision,
        host_manifest=manifest,
    )


def _host_identity_reason(identity: HostAdapterIdentity) -> str | None:
    for field, value in (
        ("host_adapter_name", identity.host_adapter_name),
        ("host_adapter_version", identity.host_adapter_version),
        ("host_contract_version", identity.host_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"HOST_ADAPTER_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_HOST_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"HOST_ADAPTER_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: HostAdapterIntegrationRequest) -> str | None:
    binding_context = request.binding_request.integration_request.context
    if request.expected_profile_id != binding_context.profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != binding_context.policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != request.binding_request.adapter_identity.runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if not isinstance(request.rollback_policy_id, str) or not request.rollback_policy_id.strip():
        return "ROLLBACK_POLICY_MISSING"
    return None


def _deny(reason: str) -> HostAdapterIntegrationDecision:
    return HostAdapterIntegrationDecision(False, reason)
