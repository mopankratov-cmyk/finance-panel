"""Disabled-by-default runtime adapter binding contracts for Phase 1E.

This module binds local contract objects to a declared adapter identity only.
It does not import Hermes runtime code, mutate gateway state, start processes,
create sandboxes, call provider/model APIs, read process environment, read auth
files, access Keychain, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_integration_contracts import (
    RuntimeIntegrationConfig,
    RuntimeIntegrationRequest,
    RuntimeIntegrationDecision,
    prepare_disabled_runtime_integration,
)


REQUIRED_ADAPTER_CAPABILITIES = frozenset(
    {
        "profile_scoped_environment",
        "grant_reference_transport",
        "audit_before_boundary",
        "broker_required",
        "fail_closed",
        "no_runtime_launch",
    }
)


@dataclass(frozen=True)
class RuntimeAdapterIdentity:
    adapter_name: str
    adapter_version: str
    adapter_contract_version: str
    runtime_backend: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeAdapterBindingConfig:
    """Disabled-by-default binding controls."""

    binding_enabled: bool = False
    integration_enabled: bool = False
    broker_channel_enabled: bool = False
    runtime_launch_enabled: bool = False
    gateway_binding_enabled: bool = False
    hermes_core_binding_enabled: bool = False


@dataclass(frozen=True)
class RuntimeAdapterBindingRequest:
    adapter_identity: RuntimeAdapterIdentity
    integration_request: RuntimeIntegrationRequest
    expected_profile_id: str
    expected_runtime_backend: str
    expected_policy_version: str


@dataclass(frozen=True)
class RuntimeAdapterBindingDecision:
    allowed: bool
    reason: str
    integration_decision: RuntimeIntegrationDecision | None = None
    binding_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False


def prepare_runtime_adapter_binding(
    *,
    request: RuntimeAdapterBindingRequest,
    config: RuntimeAdapterBindingConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> RuntimeAdapterBindingDecision:
    """Prepare a disabled adapter binding decision without binding runtime."""

    resolved_config = config or RuntimeAdapterBindingConfig()
    if not resolved_config.binding_enabled:
        return _deny("RUNTIME_ADAPTER_BINDING_DISABLED")
    if resolved_config.gateway_binding_enabled:
        return _deny("GATEWAY_BINDING_OUT_OF_SCOPE")
    if resolved_config.hermes_core_binding_enabled:
        return _deny("HERMES_CORE_BINDING_OUT_OF_SCOPE")
    if resolved_config.runtime_launch_enabled:
        return _deny("RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_BINDING")

    identity_reason = _adapter_identity_reason(request.adapter_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    integration_decision = prepare_disabled_runtime_integration(
        request=request.integration_request,
        config=RuntimeIntegrationConfig(
            integration_enabled=resolved_config.integration_enabled,
            runtime_launch_enabled=resolved_config.runtime_launch_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            audit_required=True,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if integration_decision.reason != "DISABLED_RUNTIME_INTEGRATION_CONTRACT_READY_NO_RUNTIME_STARTED":
        return RuntimeAdapterBindingDecision(False, integration_decision.reason, integration_decision)

    manifest = {
        "adapter_name": request.adapter_identity.adapter_name,
        "adapter_version": request.adapter_identity.adapter_version,
        "adapter_contract_version": request.adapter_identity.adapter_contract_version,
        "runtime_backend": request.adapter_identity.runtime_backend,
        "profile_id": request.integration_request.context.profile_id,
        "policy_version": request.integration_request.context.policy_version,
        "network_policy_id": request.integration_request.context.network_policy_id,
        "child_surfaces": ",".join(request.integration_request.child_surfaces),
        "grant_refs": ",".join(request.integration_request.credential_grant_refs),
    }
    return RuntimeAdapterBindingDecision(
        allowed=False,
        reason="RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND",
        integration_decision=integration_decision,
        binding_manifest=manifest,
    )


def _adapter_identity_reason(identity: RuntimeAdapterIdentity) -> str | None:
    for field, value in (
        ("adapter_name", identity.adapter_name),
        ("adapter_version", identity.adapter_version),
        ("adapter_contract_version", identity.adapter_contract_version),
        ("runtime_backend", identity.runtime_backend),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"ADAPTER_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_ADAPTER_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"ADAPTER_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: RuntimeAdapterBindingRequest) -> str | None:
    context = request.integration_request.context
    if request.expected_profile_id != context.profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_runtime_backend != request.adapter_identity.runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_policy_version != context.policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.integration_request.profile_environment_policy.profile_id != context.profile_id:
        return "PROFILE_POLICY_MISMATCH"
    return None


def _deny(reason: str) -> RuntimeAdapterBindingDecision:
    return RuntimeAdapterBindingDecision(False, reason)
