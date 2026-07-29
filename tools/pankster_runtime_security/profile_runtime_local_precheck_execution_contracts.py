"""Disabled-by-default profile runtime local precheck execution contracts.

This module prepares a secret-free local precheck execution manifest from local
contract objects only. It does not import Hermes runtime code, import or edit
gateway.py, import or edit web_server.py, mutate profile worker runtime state,
perform local precheck execution, perform a local precheck, perform synthetic
dry-runs, perform synthetic invocation, invoke profiles, execute profile
activation, start runtime processes, start subprocesses, create sandboxes, call
provider/model APIs, read process environment, read auth files, access Keychain,
refresh OAuth credentials, change dependencies, or materialize credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.profile_runtime_local_precheck_contracts import (
    ProfileRuntimeLocalPrecheckConfig,
    ProfileRuntimeLocalPrecheckDecision,
    ProfileRuntimeLocalPrecheckRequest,
    prepare_profile_runtime_local_precheck,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


REQUIRED_PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_CAPABILITIES = frozenset(
    {
        "profile_runtime_local_precheck_contract_ready",
        "profile_scoped_runtime",
        "sanitized_environment_only",
        "grant_reference_only_transport",
        "audit_and_broker_preconditions",
        "rollback_without_gateway_change",
        "fail_closed",
        "synthetic_only",
        "local_precheck_execution_contract_only",
        "no_profile_start",
        "no_activation_execution",
        "no_runtime_invocation",
        "no_synthetic_invocation",
        "no_synthetic_dry_run",
        "no_local_precheck",
        "no_local_precheck_execution",
        "no_runtime_process_launch",
        "no_credential_materialization",
    }
)


@dataclass(frozen=True)
class ProfileRuntimeLocalPrecheckExecutionIdentity:
    local_precheck_execution_name: str
    local_precheck_execution_version: str
    local_precheck_execution_contract_version: str
    capabilities: tuple[str, ...]


@dataclass(frozen=True)
class ProfileRuntimeLocalPrecheckExecutionConfig:
    """Disabled-by-default profile runtime local precheck execution controls."""

    profile_runtime_local_precheck_execution_contract_enabled: bool = False
    profile_runtime_local_precheck_contract_enabled: bool = False
    profile_runtime_synthetic_dry_run_contract_enabled: bool = False
    profile_runtime_synthetic_invocation_contract_enabled: bool = False
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
    profile_runtime_local_precheck_execution_enabled: bool = False
    profile_runtime_local_precheck_enabled: bool = False
    profile_runtime_synthetic_dry_run_enabled: bool = False
    profile_runtime_synthetic_invocation_enabled: bool = False
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
class ProfileRuntimeLocalPrecheckExecutionRequest:
    local_precheck_execution_identity: ProfileRuntimeLocalPrecheckExecutionIdentity
    profile_runtime_local_precheck_request: ProfileRuntimeLocalPrecheckRequest
    expected_profile_id: str
    expected_policy_version: str
    expected_runtime_backend: str
    expected_rollback_policy_id: str
    expected_wiring_policy_id: str
    expected_gateway_binding_policy_id: str
    expected_profile_worker_binding_policy_id: str
    expected_profile_runtime_activation_policy_id: str
    expected_profile_runtime_activation_execution_policy_id: str
    expected_profile_runtime_invocation_policy_id: str
    expected_profile_runtime_synthetic_invocation_policy_id: str
    expected_profile_runtime_synthetic_dry_run_policy_id: str
    expected_profile_runtime_local_precheck_policy_id: str
    profile_runtime_local_precheck_execution_policy_id: str


@dataclass(frozen=True)
class ProfileRuntimeLocalPrecheckExecutionDecision:
    allowed: bool
    reason: str
    profile_runtime_local_precheck_decision: ProfileRuntimeLocalPrecheckDecision | None = None
    profile_runtime_local_precheck_execution_manifest: Mapping[str, str] | None = None
    runtime_started: bool = False
    profile_started: bool = False
    activation_executed: bool = False
    invocation_performed: bool = False
    synthetic_invocation_performed: bool = False
    synthetic_dry_run_performed: bool = False
    local_precheck_performed: bool = False
    local_precheck_execution_performed: bool = False
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


def prepare_profile_runtime_local_precheck_execution(
    *,
    request: ProfileRuntimeLocalPrecheckExecutionRequest,
    config: ProfileRuntimeLocalPrecheckExecutionConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> ProfileRuntimeLocalPrecheckExecutionDecision:
    """Prepare local precheck execution manifest without performing execution."""

    resolved_config = config or ProfileRuntimeLocalPrecheckExecutionConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    identity_reason = _local_precheck_execution_identity_reason(request.local_precheck_execution_identity)
    if identity_reason is not None:
        return _deny(identity_reason)
    request_reason = _request_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    local_precheck_decision = prepare_profile_runtime_local_precheck(
        request=request.profile_runtime_local_precheck_request,
        config=ProfileRuntimeLocalPrecheckConfig(
            profile_runtime_local_precheck_contract_enabled=resolved_config.profile_runtime_local_precheck_contract_enabled,
            profile_runtime_synthetic_dry_run_contract_enabled=resolved_config.profile_runtime_synthetic_dry_run_contract_enabled,
            profile_runtime_synthetic_invocation_contract_enabled=resolved_config.profile_runtime_synthetic_invocation_contract_enabled,
            profile_runtime_invocation_contract_enabled=resolved_config.profile_runtime_invocation_contract_enabled,
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
            profile_runtime_local_precheck_enabled=resolved_config.profile_runtime_local_precheck_enabled,
            profile_runtime_synthetic_dry_run_enabled=resolved_config.profile_runtime_synthetic_dry_run_enabled,
            profile_runtime_synthetic_invocation_enabled=resolved_config.profile_runtime_synthetic_invocation_enabled,
            profile_runtime_invocation_enabled=resolved_config.profile_runtime_invocation_enabled,
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
    if local_precheck_decision.reason != "PROFILE_RUNTIME_LOCAL_PRECHECK_CONTRACT_READY_NO_LOCAL_PRECHECK_PERFORMED":
        return ProfileRuntimeLocalPrecheckExecutionDecision(False, local_precheck_decision.reason, local_precheck_decision)

    local_precheck_manifest = local_precheck_decision.profile_runtime_local_precheck_manifest or {}
    execution_manifest = {
        "local_precheck_execution_name": request.local_precheck_execution_identity.local_precheck_execution_name,
        "local_precheck_execution_version": request.local_precheck_execution_identity.local_precheck_execution_version,
        "local_precheck_execution_contract_version": request.local_precheck_execution_identity.local_precheck_execution_contract_version,
        "local_precheck_name": local_precheck_manifest["local_precheck_name"],
        "synthetic_dry_run_name": local_precheck_manifest["synthetic_dry_run_name"],
        "synthetic_invocation_name": local_precheck_manifest["synthetic_invocation_name"],
        "invocation_name": local_precheck_manifest["invocation_name"],
        "activation_execution_name": local_precheck_manifest["activation_execution_name"],
        "activation_name": local_precheck_manifest["activation_name"],
        "worker_binding_name": local_precheck_manifest["worker_binding_name"],
        "gateway_binding_name": local_precheck_manifest["gateway_binding_name"],
        "wiring_name": local_precheck_manifest["wiring_name"],
        "executor_name": local_precheck_manifest["executor_name"],
        "host_adapter_name": local_precheck_manifest["host_adapter_name"],
        "adapter_name": local_precheck_manifest["adapter_name"],
        "runtime_backend": request.expected_runtime_backend,
        "profile_id": request.expected_profile_id,
        "policy_version": request.expected_policy_version,
        "rollback_policy_id": request.expected_rollback_policy_id,
        "wiring_policy_id": request.expected_wiring_policy_id,
        "gateway_binding_policy_id": request.expected_gateway_binding_policy_id,
        "profile_worker_binding_policy_id": request.expected_profile_worker_binding_policy_id,
        "profile_runtime_activation_policy_id": request.expected_profile_runtime_activation_policy_id,
        "profile_runtime_activation_execution_policy_id": request.expected_profile_runtime_activation_execution_policy_id,
        "profile_runtime_invocation_policy_id": request.expected_profile_runtime_invocation_policy_id,
        "profile_runtime_synthetic_invocation_policy_id": request.expected_profile_runtime_synthetic_invocation_policy_id,
        "profile_runtime_synthetic_dry_run_policy_id": request.expected_profile_runtime_synthetic_dry_run_policy_id,
        "profile_runtime_local_precheck_policy_id": request.expected_profile_runtime_local_precheck_policy_id,
        "profile_runtime_local_precheck_execution_policy_id": request.profile_runtime_local_precheck_execution_policy_id,
        "profile_runtime_local_precheck_execution_state": "disabled_contract_ready_no_local_precheck_execution_performed",
    }
    scan = scan_secret_shapes(execution_manifest)
    if not scan.allowed:
        return ProfileRuntimeLocalPrecheckExecutionDecision(
            False,
            "PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_MANIFEST_SECRET_SCAN_FAILED",
            local_precheck_decision,
        )
    return ProfileRuntimeLocalPrecheckExecutionDecision(
        allowed=False,
        reason="PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_CONTRACT_READY_NO_LOCAL_PRECHECK_EXECUTION_PERFORMED",
        profile_runtime_local_precheck_decision=local_precheck_decision,
        profile_runtime_local_precheck_execution_manifest=execution_manifest,
    )


def _config_denial_reason(config: ProfileRuntimeLocalPrecheckExecutionConfig) -> str | None:
    if not config.profile_runtime_local_precheck_execution_contract_enabled:
        return "PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_DISABLED"
    if config.profile_runtime_local_precheck_execution_enabled:
        return "PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_OUT_OF_SCOPE"
    if config.profile_runtime_local_precheck_enabled:
        return "PROFILE_RUNTIME_LOCAL_PRECHECK_OUT_OF_SCOPE"
    if config.profile_runtime_synthetic_dry_run_enabled:
        return "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_OUT_OF_SCOPE"
    if config.profile_runtime_synthetic_invocation_enabled:
        return "PROFILE_RUNTIME_SYNTHETIC_INVOCATION_OUT_OF_SCOPE"
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


def _local_precheck_execution_identity_reason(identity: ProfileRuntimeLocalPrecheckExecutionIdentity) -> str | None:
    for field, value in (
        ("local_precheck_execution_name", identity.local_precheck_execution_name),
        ("local_precheck_execution_version", identity.local_precheck_execution_version),
        ("local_precheck_execution_contract_version", identity.local_precheck_execution_contract_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_IDENTITY_FIELD_MISSING:{field}"
    missing = sorted(REQUIRED_PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_CAPABILITIES - set(identity.capabilities))
    if missing:
        return f"PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_CAPABILITY_MISSING:{missing[0]}"
    return None


def _request_reason(request: ProfileRuntimeLocalPrecheckExecutionRequest) -> str | None:
    precheck_request = request.profile_runtime_local_precheck_request
    if request.expected_profile_id != precheck_request.expected_profile_id:
        return "EXPECTED_PROFILE_MISMATCH"
    if request.expected_policy_version != precheck_request.expected_policy_version:
        return "EXPECTED_POLICY_VERSION_MISMATCH"
    if request.expected_runtime_backend != precheck_request.expected_runtime_backend:
        return "EXPECTED_RUNTIME_BACKEND_MISMATCH"
    if request.expected_rollback_policy_id != precheck_request.expected_rollback_policy_id:
        return "EXPECTED_ROLLBACK_POLICY_MISMATCH"
    if request.expected_wiring_policy_id != precheck_request.expected_wiring_policy_id:
        return "EXPECTED_WIRING_POLICY_MISMATCH"
    if request.expected_gateway_binding_policy_id != precheck_request.expected_gateway_binding_policy_id:
        return "EXPECTED_GATEWAY_BINDING_POLICY_MISMATCH"
    if request.expected_profile_worker_binding_policy_id != precheck_request.expected_profile_worker_binding_policy_id:
        return "EXPECTED_PROFILE_WORKER_BINDING_POLICY_MISMATCH"
    if request.expected_profile_runtime_activation_policy_id != precheck_request.expected_profile_runtime_activation_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_ACTIVATION_POLICY_MISMATCH"
    if request.expected_profile_runtime_activation_execution_policy_id != precheck_request.expected_profile_runtime_activation_execution_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_ACTIVATION_EXECUTION_POLICY_MISMATCH"
    if request.expected_profile_runtime_invocation_policy_id != precheck_request.expected_profile_runtime_invocation_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_INVOCATION_POLICY_MISMATCH"
    if request.expected_profile_runtime_synthetic_invocation_policy_id != precheck_request.expected_profile_runtime_synthetic_invocation_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_SYNTHETIC_INVOCATION_POLICY_MISMATCH"
    if request.expected_profile_runtime_synthetic_dry_run_policy_id != precheck_request.expected_profile_runtime_synthetic_dry_run_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_POLICY_MISMATCH"
    if request.expected_profile_runtime_local_precheck_policy_id != precheck_request.profile_runtime_local_precheck_policy_id:
        return "EXPECTED_PROFILE_RUNTIME_LOCAL_PRECHECK_POLICY_MISMATCH"
    if not isinstance(request.profile_runtime_local_precheck_execution_policy_id, str) or not request.profile_runtime_local_precheck_execution_policy_id.strip():
        return "PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_POLICY_MISSING"
    return None


def _deny(reason: str) -> ProfileRuntimeLocalPrecheckExecutionDecision:
    return ProfileRuntimeLocalPrecheckExecutionDecision(False, reason)
