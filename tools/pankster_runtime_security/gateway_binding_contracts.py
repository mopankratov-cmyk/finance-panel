"""Disabled-by-default gateway binding contracts for Phase 1E.

This module prepares a secret-free gateway binding manifest from local contract
objects only. It does not import Hermes runtime code, import or edit gateway.py,
import or edit web_server.py, mutate gateway state, register handlers, start
runtime processes, start subprocesses, create sandboxes, call provider/model
APIs, read process environment, read auth files, access Keychain, change
dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_runtime_wiring_contracts import (
    HostRuntimeWiringConfig,
    HostRuntimeWiringDecision,
    HostRuntimeWiringRequest,
    prepare_host_runtime_wiring,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_GATEWAY_BINDING_CAPABILITIES = frozenset(
    {
        "host_runtime_wiring_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "no_gateway_mutation",
        "no_web_server_mutation",
        "no_process_launch",
    }
)


@dataclass(frozen=True)
class GatewayBindingIdentity:
    binding_name: str
    binding_version: str
    binding_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class GatewayBindingConfig:
    """Disabled-by-default gateway binding controls."""

    gateway_binding_contract_enabled: bool = False
    wiring_contract_enabled: bool = False
    execution_contract_enabled: bool = False
    host_integration_enabled: bool = False
    adapter_binding_enabled: bool = False
    runtime_integration_enabled: bool = False
    broker_channel_enabled: bool = False
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
class GatewayBindingRequest:
    binding_identity: GatewayBindingIdentity
    wiring_request: HostRuntimeWiringRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str
    expected_wiring_policy_id: str
    gateway_binding_policy_id: str


@dataclass(frozen=True)
class GatewayBindingDecision:
    allowed: bool
    reason: str
    wiring_decision: HostRuntimeWiringDecision | None = None
    gateway_binding_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    model_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependency_changed: bool = False


def prepare_gateway_binding(
    *,
    request: GatewayBindingRequest,
    config: GatewayBindingConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> GatewayBindingDecision:
    """Prepare gateway binding manifest without binding gateway runtime."""

    resolved_config = config or GatewayBindingConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _binding_identity_reason(request.binding_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    wiring_decision = prepare_host_runtime_wiring(
        request=request.wiring_request,
        config=HostRuntimeWiringConfig(
            wiring_contract_enabled=resolved_config.wiring_contract_enabled,
            execution_contract_enabled=resolved_config.execution_contract_enabled,
            host_integration_enabled=resolved_config.host_integration_enabled,
            adapter_binding_enabled=resolved_config.adapter_binding_enabled,
            runtime_integration_enabled=resolved_config.runtime_integration_enabled,
            broker_channel_enabled=resolved_config.broker_channel_enabled,
            gateway_wiring_enabled=resolved_config.gateway_runtime_mutation_enabled,
            hermes_core_wiring_enabled=resolved_config.hermes_core_binding_enabled,
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
    if wiring_decision.reason != "HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED":
        return GatewayBindingDecision(False, wiring_decision.reason, wiring_decision)

    wiring_manifest = wiring_decision.wiring_manifest or {}
    gateway_binding_manifest = {
        "binding_name": request.binding_identity.binding_name,
        "binding_version": request.binding_identity.binding_version,
        "binding_contract_version": request.binding_identity.binding_contract_version,
        "wiring_name": wiring_manifest["wiring_name"],
        "executor_name": wiring_manifest["executor_name"],
        "host_adapter_name": wiring_manifest["host_adapter_name"],
        "adapter_name": wiring_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "wiring_policy_id": request.expected_wiring_policy_id,
        "gateway_binding_policy_id": request.gateway_binding_policy_id,
        "binding_state": "disabled_contract_ready_no_gateway_bound",
    }
    scan = scan_secret_shapes(gateway_binding_manifest)
    if not scan.allowed:
        return GatewayBindingDecision(False, "GATEWAY_BINDING_MANIFEST_SECRET_SCAN_FAILED", wiring_decision)
    return GatewayBindingDecision(
        allowed=False,
        reason="GATEWAY_BINDING_CONTRACT_READY_NO_GATEWAY_BOUND",
        wiring_decision=wiring_decision,
        gateway_binding_manifest=gateway_binding_manifest,
    )


def _config_denial_reason(config: GatewayBindingConfig) -> str | None:
    if not config.gateway_binding_contract_enabled:
        return "GATEWAY_BINDING_DISABLED"
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


def _binding_identity_reason(identity: GatewayBindingIdentity) -> str | None:
    for field, value in (
        ("binding_name", identity.binding_name),
        ("binding_version", identity.binding_version),
        ("binding_contract_version", identity.binding_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"GATEWAY_BINDING_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_GATEWAY_BINDING_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"GATEWAY_BINDING_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: GatewayBindingRequest) -> str | None:
    if request.expected_profile_id != request.wiring_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != request.wiring_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != request.wiring_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != request.wiring_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if request.expected_wiring_policy_id != request.wiring_request.wiring_policy_id:
        return "EXPECTED_WIRING_POLICY_MISMATCH"
    if not isinstance(request.gateway_binding_policy_id, str) or not request.gateway_binding_policy_id.strip():
        return "GATEWAY_BINDING_POLICY_MISSING"
    return None


def _deny(reason: str) -> GatewayBindingDecision:
    return GatewayBindingDecision(False, reason)
