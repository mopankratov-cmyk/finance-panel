"""Disabled-by-default profile worker binding contracts for Phase 1E.

This module prepares a secret-free profile worker binding manifest from local
contract objects only. It does not import Hermes runtime code, import or edit
gateway.py, import or edit web_server.py, mutate profile worker runtime state,
start profiles, start runtime processes, start subprocesses, create sandboxes,
call provider/model APIs, read process environment, read auth files, access
Keychain, change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.gateway_binding_contracts import (
    GatewayBindingConfig,
    GatewayBindingDecision,
    GatewayBindingRequest,
    prepare_gateway_binding,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_PROFILE_WORKER_BINDING_CAPABILITIES = frozenset(
    {
        "gateway_binding_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "no_profile_worker_mutation",
        "no_process_launch",
    }
)


@dataclass(frozen=True)
class ProfileWorkerBindingIdentity:
    worker_binding_name: str
    worker_binding_version: str
    worker_binding_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class ProfileWorkerBindingConfig:
    """Disabled-by-default profile worker binding controls."""

    profile_worker_binding_contract_enabled: bool = False
    gateway_binding_contract_enabled: bool = False
    wiring_contract_enabled: bool = False
    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
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


@dataclass(frozen=True)
class ProfileWorkerBindingRequest:
    worker_binding_identity: ProfileWorkerBindingIdentity
    gateway_binding_request: GatewayBindingRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str
    expected_wiring_policy_id: str
    expected_gateway_binding_policy_id: str
    profile_worker_binding_policy_id: str


@dataclass(frozen=True)
class ProfileWorkerBindingDecision:
    allowed: bool
    reason: str
    gateway_binding_decision: GatewayBindingDecision | None = None
    profile_worker_binding_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    profile_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    profile_worker_changed: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_profile_worker_binding(
    *,
    request: ProfileWorkerBindingRequest,
    config: ProfileWorkerBindingConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> ProfileWorkerBindingDecision:
    """Prepare profile worker binding manifest without binding or starting worker."""

    resolved_config = config or ProfileWorkerBindingConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _worker_binding_identity_reason(request.worker_binding_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    gateway_decision = prepare_gateway_binding(
        request=request.gateway_binding_request,
        config=GatewayBindingConfig(
            gateway_binding_contract_enabled=resolved_config.gateway_binding_contract_enabled,
            wiring_contract_enabled=resolved_config.wiring_contract_enabled,
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
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
        ),
        audit_sink=audit_sink,
        broker_available=broker_available,
    )
    if gateway_decision.reason != "GATEWAY_BINDING_CONTRACT_READY_NO_GATEWAY_BOUND":
        return ProfileWorkerBindingDecision(False, gateway_decision.reason, gateway_decision)

    gateway_manifest = gateway_decision.gateway_binding_manifest or {}
    worker_manifest = {
        "worker_binding_name": request.worker_binding_identity.worker_binding_name,
        "worker_binding_version": request.worker_binding_identity.worker_binding_version,
        "worker_binding_contract_version": request.worker_binding_identity.worker_binding_contract_version,
        "gateway_binding_name": gateway_manifest["binding_name"],
        "wiring_name": gateway_manifest["wiring_name"],
        "executor_name": gateway_manifest["executor_name"],
        "host_adapter_name": gateway_manifest["host_adapter_name"],
        "adapter_name": gateway_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "wiring_policy_id": request.expected_wiring_policy_id,
        "gateway_binding_policy_id": request.expected_gateway_binding_policy_id,
        "profile_worker_binding_policy_id": request.profile_worker_binding_policy_id,
        "profile_worker_binding_state": "disabled_contract_ready_no_worker_bound",
    }
    scan = scan_secret_shapes(worker_manifest)
    if not scan.allowed:
        return ProfileWorkerBindingDecision(False, "PROFILE_WORKER_BINDING_MANIFEST_SECRET_SCAN_FAILED", gateway_decision)
    return ProfileWorkerBindingDecision(
        allowed=False,
        reason="PROFILE_WORKER_BINDING_CONTRACT_READY_NO_WORKER_BOUND",
        gateway_binding_decision=gateway_decision,
        profile_worker_binding_manifest=worker_manifest,
    )


def _config_denial_reason(config: ProfileWorkerBindingConfig) -> str | None:
    if not config.profile_worker_binding_contract_enabled:
        return "PROFILE_WORKER_BINDING_DISABLED"
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
    return None


def _worker_binding_identity_reason(identity: ProfileWorkerBindingIdentity) -> str | None:
    for field, value in (
        ("worker_binding_name", identity.worker_binding_name),
        ("worker_binding_version", identity.worker_binding_version),
        ("worker_binding_contract_version", identity.worker_binding_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"PROFILE_WORKER_BINDING_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_PROFILE_WORKER_BINDING_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"PROFILE_WORKER_BINDING_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: ProfileWorkerBindingRequest) -> str | None:
    gateway_request = request.gateway_binding_request
    if request.expected_profile_id != gateway_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != gateway_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != gateway_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != gateway_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if request.expected_wiring_policy_id != gateway_request.expected_wiring_policy_id:
        return "EXPECTED_WIRING_POLICY_MISMATCH"
    if request.expected_gateway_binding_policy_id != gateway_request.gateway_binding_policy_id:
        return "EXPECTED_GATEWAY_BINDING_POLICY_MISMATCH"
    if not isinstance(request.profile_worker_binding_policy_id, str) or not request.profile_worker_binding_policy_id.strip():
        return "PROFILE_WORKER_BINDING_POLICY_MISSING"
    return None


def _deny(reason: str) -> ProfileWorkerBindingDecision:
    return ProfileWorkerBindingDecision(False, reason)
