"""Versioned Phase 1F runtime adapter binding contracts.

This module only composes the Phase 1F scope guard with the existing disabled
adapter-binding contract. It does not bind Hermes runtime, mutate gateway state,
start processes, create sandboxes, call provider/model APIs, read environment,
read auth files, access Keychain, refresh OAuth, or materialize credentials.
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
from tools.pankster_runtime_security.runtime_integration_phase1f_contracts import (
    Phase1FVersionedImplementationScopeAttestation,
    Phase1FVersionedImplementationScopeDecision,
    phase_1f_versioned_scope_manifest,
    validate_phase_1f_versioned_implementation_scope,
)


@dataclass(frozen=True)
class Phase1FVersionedAdapterBindingConfig:
    binding_enabled: bool = False
    integration_enabled: bool = False
    broker_channel_enabled: bool = False
    runtime_launch_enabled: bool = False
    gateway_binding_enabled: bool = False
    hermes_core_binding_enabled: bool = False
    implementation_scope_required: bool = True


@dataclass(frozen=True)
class Phase1FVersionedAdapterBindingRequest:
    base_binding_request: RuntimeAdapterBindingRequest
    implementation_scope_attestation: Phase1FVersionedImplementationScopeAttestation | None
    expected_contract_version: str = "phase-1f-a6"


@dataclass(frozen=True)
class Phase1FVersionedAdapterBindingDecision:
    allowed: bool
    reason: str
    implementation_scope_decision: Phase1FVersionedImplementationScopeDecision | None = None
    base_binding_decision: RuntimeAdapterBindingDecision | None = None
    binding_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False


def prepare_phase_1f_versioned_adapter_binding(
    *,
    request: Phase1FVersionedAdapterBindingRequest,
    config: Phase1FVersionedAdapterBindingConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> Phase1FVersionedAdapterBindingDecision:
    """Prepare a Phase 1F disabled adapter binding without binding runtime."""

    resolved_config = config or Phase1FVersionedAdapterBindingConfig()
    if not resolved_config.binding_enabled:
        return _deny("PHASE_1F_VERSIONED_ADAPTER_BINDING_DISABLED")
    if resolved_config.gateway_binding_enabled:
        return _deny("GATEWAY_BINDING_OUT_OF_SCOPE")
    if resolved_config.hermes_core_binding_enabled:
        return _deny("HERMES_CORE_BINDING_OUT_OF_SCOPE")
    if resolved_config.runtime_launch_enabled:
        return _deny("RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_BINDING")
    if not isinstance(request.expected_contract_version, str) or not request.expected_contract_version.strip():
        return _deny("EXPECTED_CONTRACT_VERSION_MISSING")
    if resolved_config.implementation_scope_required:
        if request.implementation_scope_attestation is None:
            return _deny("IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")
        scope_decision = validate_phase_1f_versioned_implementation_scope(request.implementation_scope_attestation)
        if not scope_decision.allowed:
            return Phase1FVersionedAdapterBindingDecision(False, scope_decision.reason, implementation_scope_decision=scope_decision)
    else:
        scope_decision = None

    base_decision = prepare_runtime_adapter_binding(
        request=request.base_binding_request,
        config=RuntimeAdapterBindingConfig(
            binding_enabled=resolved_config.binding_enabled,
            integration_enabled=resolved_config.integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_launch_enabled=resolved_config.runtime_launch_enabled,
            gateway_binding_enabled=resolved_config.gateway_binding_enabled,
            hermes_core_binding_enabled=resolved_config.hermes_core_binding_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if base_decision.reason != "RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND":
        return Phase1FVersionedAdapterBindingDecision(False, base_decision.reason, scope_decision, base_decision)

    manifest: dict[str, str] = {
        "phase": "1F-A6",
        "contract_version": request.expected_contract_version,
    }
    if base_decision.binding_manifest is not None:
        manifest.update(dict(base_decision.binding_manifest))
    if request.implementation_scope_attestation is not None:
        manifest.update(phase_1f_versioned_scope_manifest(request.implementation_scope_attestation))
    return Phase1FVersionedAdapterBindingDecision(
        allowed=False,
        reason="PHASE_1F_VERSIONED_ADAPTER_BINDING_READY_NO_RUNTIME_BOUND",
        implementation_scope_decision=scope_decision,
        base_binding_decision=base_decision,
        binding_manifest=dict(sorted(manifest.items())),
    )


def _deny(reason: str) -> Phase1FVersionedAdapterBindingDecision:
    return Phase1FVersionedAdapterBindingDecision(False, reason)
