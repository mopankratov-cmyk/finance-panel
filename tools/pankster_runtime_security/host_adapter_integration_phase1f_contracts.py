"""Versioned Phase 1F host adapter integration contracts.

This module composes the Phase 1F versioned adapter-binding contract with the
existing disabled host-adapter contract. It is a pure contract layer: it does
not import Hermes runtime code, mutate gateway state, start processes, create
sandboxes, call provider/model APIs, read process environment, read auth files,
access Keychain, refresh OAuth, or materialize credentials.
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
from tools.pankster_runtime_security.runtime_adapter_binding_phase1f_contracts import (
    Phase1FVersionedAdapterBindingConfig,
    Phase1FVersionedAdapterBindingDecision,
    Phase1FVersionedAdapterBindingRequest,
    prepare_phase_1f_versioned_adapter_binding,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


PHASE_1F_A14_APPROVAL_COMMAND_SHA256 = "e8a8bbe6043092f59c515a3064f9019a1f1ee50932b3e3258763d3f0737688fb"
PHASE_1F_VERSIONED_HOST_ADAPTER_IMPLEMENTATION_MODE = "versioned_host_adapter_pure_contract_layer"
PHASE_1F_VERSIONED_HOST_ADAPTER_FILE_ALLOWLIST = frozenset(
    {
        "tools/pankster_runtime_security/host_adapter_integration_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_host_adapter_integration_phase1f_contracts.py",
    }
)
PHASE_1F_HASH_PINNED_PHASE_1E_HOST_ADAPTER_FILES = frozenset(
    {
        "tools/pankster_runtime_security/host_adapter_integration_contracts.py",
        "tools/tests/test_pankster_runtime_security_host_adapter_integration_contracts.py",
    }
)


@dataclass(frozen=True)
class Phase1FVersionedHostAdapterImplementationScopeAttestation:
    """Owner-approved Phase 1F host-adapter implementation boundary."""

    owner_approval_command_sha256: str
    changed_files: tuple[str, ...]
    implementation_mode: str = PHASE_1F_VERSIONED_HOST_ADAPTER_IMPLEMENTATION_MODE
    runtime_execution_requested: bool = False
    runtime_binding_requested: bool = False
    subprocess_launch_requested: bool = False
    sandbox_launch_requested: bool = False
    provider_api_call_requested: bool = False
    model_api_call_requested: bool = False
    real_credentials_requested: bool = False
    auth_store_read_requested: bool = False
    oauth_refresh_requested: bool = False
    gateway_change_requested: bool = False
    web_server_change_requested: bool = False
    hermes_core_change_requested: bool = False
    dependency_change_requested: bool = False
    production_profile_requested: bool = False
    canary_requested: bool = False
    deployment_requested: bool = False
    phase_1e_hash_pinned_file_change_requested: bool = False


@dataclass(frozen=True)
class Phase1FVersionedHostAdapterImplementationScopeDecision:
    allowed: bool
    reason: str
    approved_file_scope: tuple[str, ...] = ()
    runtime_started: bool = False
    runtime_bound: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependencies_changed: bool = False
    production_profile_touched: bool = False


@dataclass(frozen=True)
class Phase1FVersionedHostAdapterIntegrationConfig:
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    runtime_launch_enabled: bool = False
    gateway_integration_enabled: bool = False
    hermes_core_integration_enabled: bool = False
    implementation_scope_required: bool = True


@dataclass(frozen=True)
class Phase1FVersionedHostAdapterIntegrationRequest:
    base_host_request: HostAdapterIntegrationRequest
    versioned_binding_request: Phase1FVersionedAdapterBindingRequest
    implementation_scope_attestation: Phase1FVersionedHostAdapterImplementationScopeAttestation | None
    expected_host_contract_version: str = "phase-1f-a15"


@dataclass(frozen=True)
class Phase1FVersionedHostAdapterIntegrationDecision:
    allowed: bool
    reason: str
    implementation_scope_decision: Phase1FVersionedHostAdapterImplementationScopeDecision | None = None
    versioned_binding_decision: Phase1FVersionedAdapterBindingDecision | None = None
    base_host_decision: HostAdapterIntegrationDecision | None = None
    host_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    runtime_bound: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def validate_phase_1f_versioned_host_adapter_implementation_scope(
    attestation: Phase1FVersionedHostAdapterImplementationScopeAttestation,
) -> Phase1FVersionedHostAdapterImplementationScopeDecision:
    """Validate the Phase 1F-A15 versioned host-adapter implementation scope."""

    if attestation.owner_approval_command_sha256 != PHASE_1F_A14_APPROVAL_COMMAND_SHA256:
        return _scope_deny("OWNER_APPROVAL_HASH_MISMATCH")
    if attestation.implementation_mode != PHASE_1F_VERSIONED_HOST_ADAPTER_IMPLEMENTATION_MODE:
        return _scope_deny("IMPLEMENTATION_MODE_UNSUPPORTED")
    if not attestation.changed_files:
        return _scope_deny("IMPLEMENTATION_FILES_MISSING")
    if len(set(attestation.changed_files)) != len(attestation.changed_files):
        return _scope_deny("IMPLEMENTATION_FILE_DUPLICATE")
    forbidden_flag = _forbidden_scope_flag(attestation)
    if forbidden_flag is not None:
        return _scope_deny(f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{forbidden_flag}")
    for changed_file in attestation.changed_files:
        if changed_file in PHASE_1F_HASH_PINNED_PHASE_1E_HOST_ADAPTER_FILES:
            return _scope_deny(f"PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:{changed_file}")
        if changed_file not in PHASE_1F_VERSIONED_HOST_ADAPTER_FILE_ALLOWLIST:
            return _scope_deny(f"IMPLEMENTATION_FILE_OUT_OF_SCOPE:{changed_file}")
    return Phase1FVersionedHostAdapterImplementationScopeDecision(
        allowed=True,
        reason="PHASE_1F_VERSIONED_HOST_ADAPTER_PURE_CONTRACT_SCOPE_ACCEPTED_NO_RUNTIME",
        approved_file_scope=tuple(sorted(attestation.changed_files)),
    )


def phase_1f_versioned_host_adapter_scope_manifest(
    attestation: Phase1FVersionedHostAdapterImplementationScopeAttestation,
) -> dict[str, str]:
    """Return a non-secret manifest for an accepted host-adapter attestation."""

    decision = validate_phase_1f_versioned_host_adapter_implementation_scope(attestation)
    if not decision.allowed:
        return {
            "allowed": "false",
            "reason": decision.reason,
        }
    return {
        "host_adapter_scope_allowed": "true",
        "host_adapter_scope_reason": decision.reason,
        "host_adapter_implementation_mode": attestation.implementation_mode,
        "host_adapter_approval_command_sha256": attestation.owner_approval_command_sha256,
        "host_adapter_approved_file_scope": ",".join(decision.approved_file_scope),
    }


def prepare_phase_1f_versioned_host_adapter_integration(
    *,
    request: Phase1FVersionedHostAdapterIntegrationRequest,
    config: Phase1FVersionedHostAdapterIntegrationConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> Phase1FVersionedHostAdapterIntegrationDecision:
    """Prepare a Phase 1F disabled host integration without integrating runtime."""

    resolved_config = config or Phase1FVersionedHostAdapterIntegrationConfig()
    if not resolved_config.host_integration_enabled:
        return _integration_deny("PHASE_1F_VERSIONED_HOST_ADAPTER_INTEGRATION_DISABLED")
    if resolved_config.gateway_integration_enabled:
        return _integration_deny("GATEWAY_INTEGRATION_OUT_OF_SCOPE")
    if resolved_config.hermes_core_integration_enabled:
        return _integration_deny("HERMES_CORE_INTEGRATION_OUT_OF_SCOPE")
    if resolved_config.runtime_launch_enabled:
        return _integration_deny("RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_HOST_INTEGRATION")
    if not isinstance(request.expected_host_contract_version, str) or not request.expected_host_contract_version.strip():
        return _integration_deny("EXPECTED_HOST_CONTRACT_VERSION_MISSING")
    if request.versioned_binding_request.base_binding_request != request.base_host_request.binding_request:
        return _integration_deny("VERSIONED_BINDING_REQUEST_MISMATCH")

    if resolved_config.implementation_scope_required:
        if request.implementation_scope_attestation is None:
            return _integration_deny("HOST_ADAPTER_IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")
        scope_decision = validate_phase_1f_versioned_host_adapter_implementation_scope(request.implementation_scope_attestation)
        if not scope_decision.allowed:
            return Phase1FVersionedHostAdapterIntegrationDecision(False, scope_decision.reason, implementation_scope_decision=scope_decision)
    else:
        scope_decision = None

    versioned_binding_decision = prepare_phase_1f_versioned_adapter_binding(
        request=request.versioned_binding_request,
        config=Phase1FVersionedAdapterBindingConfig(
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
    if versioned_binding_decision.reason != "PHASE_1F_VERSIONED_ADAPTER_BINDING_READY_NO_RUNTIME_BOUND":
        return Phase1FVersionedHostAdapterIntegrationDecision(False, versioned_binding_decision.reason, scope_decision, versioned_binding_decision)

    base_host_decision = prepare_host_adapter_integration(
        request=request.base_host_request,
        config=HostAdapterIntegrationConfig(
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_launch_enabled=resolved_config.runtime_launch_enabled,
            gateway_integration_enabled=resolved_config.gateway_integration_enabled,
            hermes_core_integration_enabled=resolved_config.hermes_core_integration_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if base_host_decision.reason != "HOST_ADAPTER_INTEGRATION_CONTRACT_READY_NO_RUNTIME_INTEGRATED":
        return Phase1FVersionedHostAdapterIntegrationDecision(False, base_host_decision.reason, scope_decision, versioned_binding_decision, base_host_decision)

    manifest: dict[str, str] = {
        "phase": "1F-A15",
        "host_contract_version": request.expected_host_contract_version,
        "host_integration_state": "versioned_disabled_contract_ready",
    }
    if base_host_decision.host_manifest is not None:
        manifest.update(dict(base_host_decision.host_manifest))
    if versioned_binding_decision.binding_manifest is not None:
        manifest.update({f"versioned_binding_{key}": value for key, value in versioned_binding_decision.binding_manifest.items()})
    if request.implementation_scope_attestation is not None:
        manifest.update(phase_1f_versioned_host_adapter_scope_manifest(request.implementation_scope_attestation))
    scan = scan_secret_shapes(manifest)
    if not scan.allowed:
        return Phase1FVersionedHostAdapterIntegrationDecision(False, "PHASE_1F_HOST_MANIFEST_SECRET_SCAN_FAILED", scope_decision, versioned_binding_decision, base_host_decision)
    return Phase1FVersionedHostAdapterIntegrationDecision(
        allowed=False,
        reason="PHASE_1F_VERSIONED_HOST_ADAPTER_INTEGRATION_READY_NO_RUNTIME_INTEGRATED",
        implementation_scope_decision=scope_decision,
        versioned_binding_decision=versioned_binding_decision,
        base_host_decision=base_host_decision,
        host_manifest=dict(sorted(manifest.items())),
    )


def _scope_deny(reason: str) -> Phase1FVersionedHostAdapterImplementationScopeDecision:
    return Phase1FVersionedHostAdapterImplementationScopeDecision(False, reason)


def _integration_deny(reason: str) -> Phase1FVersionedHostAdapterIntegrationDecision:
    return Phase1FVersionedHostAdapterIntegrationDecision(False, reason)


def _forbidden_scope_flag(attestation: Phase1FVersionedHostAdapterImplementationScopeAttestation) -> str | None:
    for field in (
        "runtime_execution_requested",
        "runtime_binding_requested",
        "subprocess_launch_requested",
        "sandbox_launch_requested",
        "provider_api_call_requested",
        "model_api_call_requested",
        "real_credentials_requested",
        "auth_store_read_requested",
        "oauth_refresh_requested",
        "gateway_change_requested",
        "web_server_change_requested",
        "hermes_core_change_requested",
        "dependency_change_requested",
        "production_profile_requested",
        "canary_requested",
        "deployment_requested",
        "phase_1e_hash_pinned_file_change_requested",
    ):
        if getattr(attestation, field):
            return field
    return None
