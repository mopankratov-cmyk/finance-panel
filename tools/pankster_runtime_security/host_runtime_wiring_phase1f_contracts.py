"""Versioned Phase 1F host runtime wiring contracts.

This module composes the Phase 1F versioned host runtime execution contract
with the existing disabled host runtime wiring contract. It is a pure contract
layer: it does not import Hermes runtime code, mutate gateway state, wire
gateway/profile-worker handlers, start processes, create sandboxes, call
provider/model APIs, read process environment, read auth files, access
Keychain, refresh OAuth, change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_runtime_execution_phase1f_contracts import (
    Phase1FVersionedHostRuntimeExecutionConfig,
    Phase1FVersionedHostRuntimeExecutionDecision,
    Phase1FVersionedHostRuntimeExecutionRequest,
    prepare_phase_1f_versioned_host_runtime_execution,
)
from tools.pankster_runtime_security.host_runtime_wiring_contracts import (
    HostRuntimeWiringConfig,
    HostRuntimeWiringDecision,
    HostRuntimeWiringRequest,
    prepare_host_runtime_wiring,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


PHASE_1F_A20_APPROVAL_COMMAND_SHA256 = "1e32bf6bb16ca879f212bb79b9a44bdf960f7504fd6e997005311686444fa692"
PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_MODE = "versioned_host_runtime_wiring_pure_contract_layer"
PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_FILE_ALLOWLIST = frozenset(
    {
        "tools/pankster_runtime_security/host_runtime_wiring_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_host_runtime_wiring_phase1f_contracts.py",
    }
)
PHASE_1F_HASH_PINNED_PHASE_1E_HOST_WIRING_FILES = frozenset(
    {
        "tools/pankster_runtime_security/host_runtime_wiring_contracts.py",
        "tools/tests/test_pankster_runtime_security_host_runtime_wiring_contracts.py",
    }
)


@dataclass(frozen=True)
class Phase1FVersionedHostRuntimeWiringScopeAttestation:
    """Owner-approved Phase 1F host runtime wiring implementation boundary."""

    owner_approval_command_sha256: str
    changed_files: tuple[str, ...]
    implementation_mode: str = PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_MODE
    gateway_wiring_requested: bool = False
    profile_worker_wiring_requested: bool = False
    runtime_process_launch_requested: bool = False
    runtime_binding_requested: bool = False
    profile_runtime_execution_requested: bool = False
    subprocess_launch_requested: bool = False
    sandbox_launch_requested: bool = False
    provider_api_call_requested: bool = False
    model_api_call_requested: bool = False
    real_credentials_requested: bool = False
    auth_store_read_requested: bool = False
    keychain_read_requested: bool = False
    process_env_secret_read_requested: bool = False
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
class Phase1FVersionedHostRuntimeWiringScopeDecision:
    allowed: bool
    reason: str
    approved_file_scope: tuple[str, ...] = ()
    gateway_wired: bool = False
    profile_worker_wired: bool = False
    runtime_started: bool = False
    runtime_bound: bool = False
    profile_runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    auth_store_read: bool = False
    keychain_read: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependencies_changed: bool = False
    production_profile_touched: bool = False


@dataclass(frozen=True)
class Phase1FVersionedHostRuntimeWiringConfig:
    wiring_contract_enabled: bool = False
    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
    gateway_wiring_enabled: bool = False
    profile_worker_wiring_enabled: bool = False
    hermes_core_wiring_enabled: bool = False
    dependency_changes_enabled: bool = False
    runtime_process_launch_enabled: bool = False
    runtime_binding_enabled: bool = False
    profile_runtime_execution_enabled: bool = False
    subprocess_launch_enabled: bool = False
    sandbox_creation_enabled: bool = False
    provider_model_api_enabled: bool = False
    credential_materialization_enabled: bool = False
    implementation_scope_required: bool = True


@dataclass(frozen=True)
class Phase1FVersionedHostRuntimeWiringRequest:
    base_wiring_request: HostRuntimeWiringRequest
    versioned_execution_request: Phase1FVersionedHostRuntimeExecutionRequest
    implementation_scope_attestation: Phase1FVersionedHostRuntimeWiringScopeAttestation | None
    expected_wiring_contract_version: str = "phase-1f-a21"


@dataclass(frozen=True)
class Phase1FVersionedHostRuntimeWiringDecision:
    allowed: bool
    reason: str
    implementation_scope_decision: Phase1FVersionedHostRuntimeWiringScopeDecision | None = None
    versioned_execution_decision: Phase1FVersionedHostRuntimeExecutionDecision | None = None
    base_wiring_decision: HostRuntimeWiringDecision | None = None
    wiring_manifest: Mapping[str, str] | None = None
    gateway_wired: bool = False
    profile_worker_wired: bool = False
    runtime_started: bool = False
    runtime_bound: bool = False
    profile_runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    auth_store_read: bool = False
    keychain_read: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def validate_phase_1f_versioned_host_runtime_wiring_scope(
    attestation: Phase1FVersionedHostRuntimeWiringScopeAttestation,
) -> Phase1FVersionedHostRuntimeWiringScopeDecision:
    """Validate the Phase 1F-A21 versioned host runtime wiring scope."""

    if attestation.owner_approval_command_sha256 != PHASE_1F_A20_APPROVAL_COMMAND_SHA256:
        return _scope_deny("OWNER_APPROVAL_HASH_MISMATCH")
    if attestation.implementation_mode != PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_MODE:
        return _scope_deny("IMPLEMENTATION_MODE_UNSUPPORTED")
    if not attestation.changed_files:
        return _scope_deny("IMPLEMENTATION_FILES_MISSING")
    if len(set(attestation.changed_files)) != len(attestation.changed_files):
        return _scope_deny("IMPLEMENTATION_FILE_DUPLICATE")
    forbidden_flag = _forbidden_scope_flag(attestation)
    if forbidden_flag is not None:
        return _scope_deny(f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{forbidden_flag}")
    for changed_file in attestation.changed_files:
        if changed_file in PHASE_1F_HASH_PINNED_PHASE_1E_HOST_WIRING_FILES:
            return _scope_deny(f"PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:{changed_file}")
        if changed_file not in PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_FILE_ALLOWLIST:
            return _scope_deny(f"IMPLEMENTATION_FILE_OUT_OF_SCOPE:{changed_file}")
    return Phase1FVersionedHostRuntimeWiringScopeDecision(
        allowed=True,
        reason="PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_PURE_CONTRACT_SCOPE_ACCEPTED_NO_GATEWAY_WIRED",
        approved_file_scope=tuple(sorted(attestation.changed_files)),
    )


def phase_1f_versioned_host_runtime_wiring_scope_manifest(
    attestation: Phase1FVersionedHostRuntimeWiringScopeAttestation,
) -> dict[str, str]:
    """Return a non-secret manifest for an accepted host-wiring attestation."""

    decision = validate_phase_1f_versioned_host_runtime_wiring_scope(attestation)
    if not decision.allowed:
        return {
            "allowed": "false",
            "reason": decision.reason,
        }
    return {
        "host_wiring_scope_allowed": "true",
        "host_wiring_scope_reason": decision.reason,
        "host_wiring_implementation_mode": attestation.implementation_mode,
        "host_wiring_approval_command_sha256": attestation.owner_approval_command_sha256,
        "host_wiring_approved_file_scope": ",".join(decision.approved_file_scope),
    }


def prepare_phase_1f_versioned_host_runtime_wiring(
    *,
    request: Phase1FVersionedHostRuntimeWiringRequest,
    config: Phase1FVersionedHostRuntimeWiringConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> Phase1FVersionedHostRuntimeWiringDecision:
    """Prepare a Phase 1F disabled host wiring manifest without wiring gateway."""

    resolved_config = config or Phase1FVersionedHostRuntimeWiringConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _wiring_deny(config_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _wiring_deny(request_reason)

    if resolved_config.implementation_scope_required:
        if request.implementation_scope_attestation is None:
            return _wiring_deny("HOST_WIRING_IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")
        scope_decision = validate_phase_1f_versioned_host_runtime_wiring_scope(request.implementation_scope_attestation)
        if not scope_decision.allowed:
            return Phase1FVersionedHostRuntimeWiringDecision(False, scope_decision.reason, implementation_scope_decision=scope_decision)
    else:
        scope_decision = None

    versioned_execution_decision = prepare_phase_1f_versioned_host_runtime_execution(
        request=request.versioned_execution_request,
        config=Phase1FVersionedHostRuntimeExecutionConfig(
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            runtime_process_launch_enabled=resolved_config.runtime_process_launch_enabled,
            runtime_binding_enabled=resolved_config.runtime_binding_enabled,
            profile_runtime_execution_enabled=resolved_config.profile_runtime_execution_enabled,
            subprocess_launch_enabled=resolved_config.subprocess_launch_enabled,
            sandbox_creation_enabled=resolved_config.sandbox_creation_enabled,
            provider_model_api_enabled=resolved_config.provider_model_api_enabled,
            credential_materialization_enabled=resolved_config.credential_materialization_enabled,
            gateway_integration_enabled=resolved_config.gateway_wiring_enabled,
            profile_worker_binding_enabled=resolved_config.profile_worker_wiring_enabled,
            hermes_core_integration_enabled=resolved_config.hermes_core_wiring_enabled,
            dependency_changes_enabled=resolved_config.dependency_changes_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if versioned_execution_decision.reason != "PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED":
        return Phase1FVersionedHostRuntimeWiringDecision(False, versioned_execution_decision.reason, scope_decision, versioned_execution_decision)

    base_wiring_decision = prepare_host_runtime_wiring(
        request=request.base_wiring_request,
        config=HostRuntimeWiringConfig(
            wiring_contract_enabled=resolved_config.wiring_contract_enabled,
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            gateway_wiring_enabled=resolved_config.gateway_wiring_enabled,
            hermes_core_wiring_enabled=resolved_config.hermes_core_wiring_enabled,
            dependency_changes_enabled=resolved_config.dependency_changes_enabled,
            runtime_process_launch_enabled=resolved_config.runtime_process_launch_enabled,
            subprocess_launch_enabled=resolved_config.subprocess_launch_enabled,
            sandbox_creation_enabled=resolved_config.sandbox_creation_enabled,
            provider_model_api_enabled=resolved_config.provider_model_api_enabled,
            credential_materialization_enabled=resolved_config.credential_materialization_enabled,
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if base_wiring_decision.reason != "HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED":
        return Phase1FVersionedHostRuntimeWiringDecision(False, base_wiring_decision.reason, scope_decision, versioned_execution_decision, base_wiring_decision)

    manifest: dict[str, str] = {}
    if base_wiring_decision.wiring_manifest is not None:
        manifest.update(dict(base_wiring_decision.wiring_manifest))
    if versioned_execution_decision.execution_manifest is not None:
        manifest.update({f"versioned_execution_{key}": value for key, value in versioned_execution_decision.execution_manifest.items()})
    manifest.update(
        {
            "phase": "1F-A21",
            "wiring_contract_version": request.expected_wiring_contract_version,
            "wiring_state": "versioned_disabled_contract_ready_no_gateway_wired",
        }
    )
    if request.implementation_scope_attestation is not None:
        manifest.update(phase_1f_versioned_host_runtime_wiring_scope_manifest(request.implementation_scope_attestation))
    scan = scan_secret_shapes(manifest)
    if not scan.allowed:
        return Phase1FVersionedHostRuntimeWiringDecision(False, "PHASE_1F_HOST_WIRING_MANIFEST_SECRET_SCAN_FAILED", scope_decision, versioned_execution_decision, base_wiring_decision)
    return Phase1FVersionedHostRuntimeWiringDecision(
        allowed=False,
        reason="PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED",
        implementation_scope_decision=scope_decision,
        versioned_execution_decision=versioned_execution_decision,
        base_wiring_decision=base_wiring_decision,
        wiring_manifest=dict(sorted(manifest.items())),
    )


def _config_denial_reason(config: Phase1FVersionedHostRuntimeWiringConfig) -> str | None:
    if not config.wiring_contract_enabled:
        return "PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_DISABLED"
    if config.gateway_wiring_enabled:
        return "GATEWAY_WIRING_OUT_OF_SCOPE"
    if config.profile_worker_wiring_enabled:
        return "PROFILE_WORKER_WIRING_OUT_OF_SCOPE"
    if config.hermes_core_wiring_enabled:
        return "HERMES_CORE_WIRING_OUT_OF_SCOPE"
    if config.dependency_changes_enabled:
        return "DEPENDENCY_CHANGES_OUT_OF_SCOPE"
    if config.runtime_process_launch_enabled:
        return "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"
    if config.runtime_binding_enabled:
        return "RUNTIME_BINDING_OUT_OF_SCOPE"
    if config.profile_runtime_execution_enabled:
        return "PROFILE_RUNTIME_EXECUTION_OUT_OF_SCOPE"
    if config.subprocess_launch_enabled:
        return "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"
    if config.sandbox_creation_enabled:
        return "SANDBOX_CREATION_OUT_OF_SCOPE"
    if config.provider_model_api_enabled:
        return "PROVIDER_MODEL_API_OUT_OF_SCOPE"
    if config.credential_materialization_enabled:
        return "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"
    return None


def _request_reason(request: Phase1FVersionedHostRuntimeWiringRequest) -> str | None:
    if not isinstance(request.expected_wiring_contract_version, str) or not request.expected_wiring_contract_version.strip():
        return "EXPECTED_WIRING_CONTRACT_VERSION_MISSING"
    if request.versioned_execution_request.base_execution_request != request.base_wiring_request.execution_request:
        return "VERSIONED_EXECUTION_REQUEST_MISMATCH"
    if request.base_wiring_request.expected_profile_id != request.versioned_execution_request.base_execution_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.base_wiring_request.expected_policy_version != request.versioned_execution_request.base_execution_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.base_wiring_request.expected_runtime_backend != request.versioned_execution_request.base_execution_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.base_wiring_request.expected_rollback_policy_id != request.versioned_execution_request.base_execution_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if not isinstance(request.base_wiring_request.wiring_policy_id, str) or not request.base_wiring_request.wiring_policy_id.strip():
        return "WIRING_POLICY_MISSING"
    return None


def _scope_deny(reason: str) -> Phase1FVersionedHostRuntimeWiringScopeDecision:
    return Phase1FVersionedHostRuntimeWiringScopeDecision(False, reason)


def _wiring_deny(reason: str) -> Phase1FVersionedHostRuntimeWiringDecision:
    return Phase1FVersionedHostRuntimeWiringDecision(False, reason)


def _forbidden_scope_flag(attestation: Phase1FVersionedHostRuntimeWiringScopeAttestation) -> str | None:
    for field in (
        "gateway_wiring_requested",
        "profile_worker_wiring_requested",
        "runtime_process_launch_requested",
        "runtime_binding_requested",
        "profile_runtime_execution_requested",
        "subprocess_launch_requested",
        "sandbox_launch_requested",
        "provider_api_call_requested",
        "model_api_call_requested",
        "real_credentials_requested",
        "auth_store_read_requested",
        "keychain_read_requested",
        "process_env_secret_read_requested",
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
