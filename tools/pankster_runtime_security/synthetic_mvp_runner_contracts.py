"""Pure synthetic-only MVP runner contracts for Phase 2-A1.

This module implements the narrow Phase 2-A1 MVP allowed by the Phase 2-A0
owner approval. It is intentionally local and side-effect free: it does not
start Hermes gateway, start profiles, launch runtime processes, launch
subprocesses or sandboxes, call provider/model/network APIs, read process
environment, read auth files, access Keychain, refresh OAuth credentials,
materialize real credentials, change dependencies, deploy, or canary.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Mapping

from tools.pankster_runtime_security.environment_sanitizer import SanitizedEnvironment, sanitize_environment
from tools.pankster_runtime_security.fake_grants import FakeGrantRegistry
from tools.pankster_runtime_security.fake_model_broker import FakeModelBroker, FakeModelRequest
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


PHASE_2_A0_APPROVAL_COMMAND = (
    "APPROVE_PHASE_2_SYNTHETIC_MVP_IMPLEMENTATION:"
    "p2-20260723-syntheticmvpa0:"
    "4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96"
)
PHASE_2_A0_APPROVAL_COMMAND_SHA256 = "8c559fd59bca0e3f0f499df142bf17ad548b54d9b7059ef02b5a25a4704c19ef"
PHASE_2_A0_CONTRACT_CONTENT_SHA256 = "4f8794c9ca615e2d301c70cb30004fc08ae1fdc8e5ebe3a4cf5cdc48c9f82b96"

REQUIRED_SURFACES = ("terminal", "code_execution", "delegate_task", "mcp")
FAKE_OR_FAIL_CLOSED_MODES = frozenset({"fake", "fail_closed"})


@dataclass(frozen=True)
class SyntheticMvpProfile:
    """Synthetic profile identity and model allowlist."""

    profile_id: str
    workflow_id: str
    policy_version: str
    runtime_backend: str
    runtime_identity_hash: str
    synthetic_only: bool
    provider_family: str
    model_allowlist: tuple[str, ...]
    operation_allowlist: tuple[str, ...]


@dataclass(frozen=True)
class SyntheticMvpSurfacePolicy:
    """Fake/fail-closed child surface policy."""

    terminal: str = "fake"
    code_execution: str = "fake"
    delegate_task: str = "fail_closed"
    mcp: str = "fail_closed"


@dataclass(frozen=True)
class SyntheticMvpConfig:
    """Phase 2-A1 synthetic MVP controls."""

    synthetic_mvp_enabled: bool = False
    fake_credentials_enabled: bool = True
    fake_model_broker_enabled: bool = True
    sanitized_environment_required: bool = True
    terminal_surface_required: bool = True
    code_execution_surface_required: bool = True
    delegate_task_surface_required: bool = True
    mcp_surface_required: bool = True
    fail_on_denied_environment_keys: bool = True
    fail_on_ignored_environment_keys: bool = False
    gateway_start_enabled: bool = False
    production_profiles_enabled: bool = False
    profile_runtime_execution_enabled: bool = False
    profile_start_enabled: bool = False
    real_credentials_enabled: bool = False
    auth_file_reads_enabled: bool = False
    keychain_reads_enabled: bool = False
    oauth_refresh_enabled: bool = False
    provider_model_api_enabled: bool = False
    network_calls_enabled: bool = False
    runtime_process_launch_enabled: bool = False
    subprocess_launch_enabled: bool = False
    sandbox_creation_enabled: bool = False
    dependency_changes_enabled: bool = False
    deployment_enabled: bool = False
    canary_enabled: bool = False


@dataclass(frozen=True)
class SyntheticMvpRequest:
    """Explicit input for one synthetic MVP occurrence."""

    owner_approval_command: str
    profile: SyntheticMvpProfile
    task_id: str
    attempt_id: str
    sequence_id: str
    purpose: str
    operation: str
    model: str
    input_payload: str
    source_environment: Mapping[str, object]
    surface_policy: SyntheticMvpSurfacePolicy = SyntheticMvpSurfacePolicy()
    grant_ttl_seconds: int = 300
    grant_budget_requests: int = 1


@dataclass(frozen=True)
class SurfaceResult:
    """Secret-free synthetic child surface decision."""

    name: str
    mode: str
    allowed: bool
    reason: str
    sanitized_environment: Mapping[str, str]


@dataclass(frozen=True)
class SyntheticMvpDecision:
    """Synthetic MVP result with explicit non-production safety flags."""

    allowed: bool
    reason: str
    manifest: Mapping[str, object] | None = None
    sanitized_environment: SanitizedEnvironment | None = None
    surface_results: tuple[SurfaceResult, ...] = ()
    fake_model_payload: str | None = None
    runtime_started: bool = False
    gateway_started: bool = False
    profile_started: bool = False
    profile_runtime_executed: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    network_call_performed: bool = False
    real_credentials_materialized: bool = False
    auth_files_read: bool = False
    keychain_read: bool = False
    oauth_refresh_performed: bool = False
    dependency_changed: bool = False
    deployment_performed: bool = False
    canary_performed: bool = False


def run_synthetic_mvp(
    *,
    request: SyntheticMvpRequest,
    config: SyntheticMvpConfig | None = None,
) -> SyntheticMvpDecision:
    """Run one pure in-memory synthetic MVP occurrence."""

    resolved_config = config or SyntheticMvpConfig()
    config_reason = _config_denial_reason(resolved_config)
    if config_reason is not None:
        return _deny(config_reason)

    approval_reason = _approval_denial_reason(request.owner_approval_command)
    if approval_reason is not None:
        return _deny(approval_reason)

    profile_reason = _profile_denial_reason(request.profile)
    if profile_reason is not None:
        return _deny(profile_reason)

    request_reason = _request_denial_reason(request)
    if request_reason is not None:
        return _deny(request_reason)

    sanitized = sanitize_environment(request.source_environment)
    if resolved_config.sanitized_environment_required and sanitized.env == {}:
        return _deny("SANITIZED_ENVIRONMENT_EMPTY")
    if resolved_config.fail_on_denied_environment_keys and sanitized.denied_keys:
        return _deny("SOURCE_ENVIRONMENT_DENIED_KEYS_PRESENT", sanitized_environment=sanitized)
    if resolved_config.fail_on_ignored_environment_keys and sanitized.ignored_keys:
        return _deny("SOURCE_ENVIRONMENT_IGNORED_KEYS_PRESENT", sanitized_environment=sanitized)
    if not scan_secret_shapes(sanitized.env).allowed:
        return _deny("SANITIZED_ENVIRONMENT_SECRET_SCAN_FAILED", sanitized_environment=sanitized)

    surfaces = _prepare_surface_results(request.surface_policy, sanitized.env)
    surface_reason = _surface_denial_reason(resolved_config, surfaces)
    if surface_reason is not None:
        return _deny(surface_reason, sanitized_environment=sanitized, surface_results=surfaces)

    registry = FakeGrantRegistry()
    grant_decision = registry.issue_grant(
        profile_id=request.profile.profile_id,
        workflow_id=request.profile.workflow_id,
        task_id=request.task_id,
        attempt_id=request.attempt_id,
        purpose=request.purpose,
        provider_family=request.profile.provider_family,
        model_allowlist=request.profile.model_allowlist,
        operation_allowlist=request.profile.operation_allowlist,
        ttl_seconds=request.grant_ttl_seconds,
        budget_requests=request.grant_budget_requests,
        policy_version=request.profile.policy_version,
        runtime_identity_hash=request.profile.runtime_identity_hash,
        network_policy_id="deny-all-outbound-synthetic",
    )
    if not grant_decision.allowed or grant_decision.grant is None:
        return _deny(grant_decision.reason, sanitized_environment=sanitized, surface_results=surfaces)

    broker = FakeModelBroker(registry)
    model_response = broker.complete(
        FakeModelRequest(
            grant_id=grant_decision.grant.grant_id,
            profile_id=request.profile.profile_id,
            task_id=request.task_id,
            attempt_id=request.attempt_id,
            runtime_identity_hash=request.profile.runtime_identity_hash,
            provider_family=request.profile.provider_family,
            model=request.model,
            operation=request.operation,
            sequence_id=request.sequence_id,
            input_payload_hash=sha256(request.input_payload.encode("utf-8")).hexdigest(),
        )
    )
    if not model_response.allowed:
        return _deny(model_response.reason, sanitized_environment=sanitized, surface_results=surfaces)

    manifest: dict[str, object] = {
        "phase": "2-A1",
        "status": "PHASE_2_A1_SYNTHETIC_MVP_IMPLEMENTATION_COMPLETE_SYNTHETIC_ONLY",
        "approval_command_sha256": PHASE_2_A0_APPROVAL_COMMAND_SHA256,
        "approval_contract_content_sha256": PHASE_2_A0_CONTRACT_CONTENT_SHA256,
        "profile_id": request.profile.profile_id,
        "workflow_id": request.profile.workflow_id,
        "task_id": request.task_id,
        "attempt_id": request.attempt_id,
        "sequence_id": request.sequence_id,
        "policy_version": request.profile.policy_version,
        "runtime_backend": request.profile.runtime_backend,
        "network_policy_id": "deny-all-outbound-synthetic",
        "fake_credentials_only": True,
        "fake_model_broker_only": True,
        "real_credentials_materialized": False,
        "provider_api_calls_performed": False,
        "model_api_calls_performed": False,
        "network_calls_performed": False,
        "runtime_process_started": False,
        "subprocess_started": False,
        "sandbox_started": False,
        "gateway_started": False,
        "profile_started": False,
        "profile_runtime_executed": False,
        "auth_files_read": False,
        "keychain_read": False,
        "oauth_refresh_performed": False,
        "sanitized_environment_keys": tuple(sorted(sanitized.env)),
        "denied_environment_keys": sanitized.denied_keys,
        "ignored_environment_keys": sanitized.ignored_keys,
        "surface_modes": {surface.name: surface.mode for surface in surfaces},
        "surface_reasons": {surface.name: surface.reason for surface in surfaces},
        "grant_id_prefix": "grant_opaque_",
        "grant_budget_used": model_response.usage["requests"],
        "fake_audit_event_id": model_response.audit_event_id,
        "fake_model_result_hash": sha256((model_response.result_payload or "").encode("utf-8")).hexdigest(),
    }
    scan = scan_secret_shapes(manifest)
    if not scan.allowed:
        return _deny("SYNTHETIC_MVP_MANIFEST_SECRET_SCAN_FAILED", sanitized_environment=sanitized, surface_results=surfaces)

    return SyntheticMvpDecision(
        allowed=True,
        reason="SYNTHETIC_MVP_COMPLETED_SYNTHETIC_ONLY",
        manifest=manifest,
        sanitized_environment=sanitized,
        surface_results=surfaces,
        fake_model_payload=model_response.result_payload,
    )


def _approval_denial_reason(approval_command: str) -> str | None:
    if approval_command != PHASE_2_A0_APPROVAL_COMMAND:
        return "OWNER_APPROVAL_COMMAND_MISMATCH"
    if sha256(approval_command.encode("utf-8")).hexdigest() != PHASE_2_A0_APPROVAL_COMMAND_SHA256:
        return "OWNER_APPROVAL_COMMAND_SHA_MISMATCH"
    return None


def _config_denial_reason(config: SyntheticMvpConfig) -> str | None:
    if not config.synthetic_mvp_enabled:
        return "SYNTHETIC_MVP_DISABLED"
    if not config.fake_credentials_enabled:
        return "FAKE_CREDENTIALS_REQUIRED"
    if not config.fake_model_broker_enabled:
        return "FAKE_MODEL_BROKER_REQUIRED"
    for field, reason in (
        ("gateway_start_enabled", "GATEWAY_START_OUT_OF_SCOPE"),
        ("production_profiles_enabled", "PRODUCTION_PROFILES_OUT_OF_SCOPE"),
        ("profile_runtime_execution_enabled", "PROFILE_RUNTIME_EXECUTION_OUT_OF_SCOPE"),
        ("profile_start_enabled", "PROFILE_START_OUT_OF_SCOPE"),
        ("real_credentials_enabled", "REAL_CREDENTIALS_OUT_OF_SCOPE"),
        ("auth_file_reads_enabled", "AUTH_FILE_READS_OUT_OF_SCOPE"),
        ("keychain_reads_enabled", "KEYCHAIN_READS_OUT_OF_SCOPE"),
        ("oauth_refresh_enabled", "OAUTH_REFRESH_OUT_OF_SCOPE"),
        ("provider_model_api_enabled", "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
        ("network_calls_enabled", "NETWORK_CALLS_OUT_OF_SCOPE"),
        ("runtime_process_launch_enabled", "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
        ("subprocess_launch_enabled", "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
        ("sandbox_creation_enabled", "SANDBOX_CREATION_OUT_OF_SCOPE"),
        ("dependency_changes_enabled", "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
        ("deployment_enabled", "DEPLOYMENT_OUT_OF_SCOPE"),
        ("canary_enabled", "CANARY_OUT_OF_SCOPE"),
    ):
        if getattr(config, field):
            return reason
    return None


def _profile_denial_reason(profile: SyntheticMvpProfile) -> str | None:
    for field, value in (
        ("profile_id", profile.profile_id),
        ("workflow_id", profile.workflow_id),
        ("policy_version", profile.policy_version),
        ("runtime_backend", profile.runtime_backend),
        ("runtime_identity_hash", profile.runtime_identity_hash),
        ("provider_family", profile.provider_family),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"SYNTHETIC_PROFILE_FIELD_MISSING:{field}"
    if not profile.synthetic_only:
        return "PROFILE_NOT_SYNTHETIC"
    if profile.runtime_backend != "synthetic-only-mvp":
        return "RUNTIME_BACKEND_NOT_SYNTHETIC_MVP"
    if not profile.model_allowlist:
        return "MODEL_ALLOWLIST_EMPTY"
    if not profile.operation_allowlist:
        return "OPERATION_ALLOWLIST_EMPTY"
    return None


def _request_denial_reason(request: SyntheticMvpRequest) -> str | None:
    for field, value in (
        ("task_id", request.task_id),
        ("attempt_id", request.attempt_id),
        ("sequence_id", request.sequence_id),
        ("purpose", request.purpose),
        ("operation", request.operation),
        ("model", request.model),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"SYNTHETIC_MVP_REQUEST_FIELD_MISSING:{field}"
    if request.model not in request.profile.model_allowlist:
        return "MODEL_NOT_ALLOWLISTED"
    if request.operation not in request.profile.operation_allowlist:
        return "OPERATION_NOT_ALLOWLISTED"
    if request.grant_ttl_seconds <= 0:
        return "INVALID_GRANT_TTL"
    if request.grant_budget_requests < 1:
        return "INVALID_GRANT_BUDGET"
    scan = scan_secret_shapes(
        {
            "profile_id": request.profile.profile_id,
            "task_id": request.task_id,
            "attempt_id": request.attempt_id,
            "sequence_id": request.sequence_id,
            "purpose": request.purpose,
            "operation": request.operation,
            "model": request.model,
            "input_payload": request.input_payload,
        }
    )
    if not scan.allowed:
        return "SYNTHETIC_MVP_REQUEST_SECRET_SCAN_FAILED"
    return None


def _prepare_surface_results(policy: SyntheticMvpSurfacePolicy, sanitized_env: Mapping[str, str]) -> tuple[SurfaceResult, ...]:
    values = {
        "terminal": policy.terminal,
        "code_execution": policy.code_execution,
        "delegate_task": policy.delegate_task,
        "mcp": policy.mcp,
    }
    results: list[SurfaceResult] = []
    for name in REQUIRED_SURFACES:
        mode = values[name]
        if mode == "fake":
            results.append(SurfaceResult(name, mode, True, "FAKE_SURFACE_COMPLETED", dict(sanitized_env)))
        elif mode == "fail_closed":
            results.append(SurfaceResult(name, mode, False, "SURFACE_FAIL_CLOSED_NOT_AVAILABLE", dict(sanitized_env)))
        else:
            results.append(SurfaceResult(name, mode, False, "SURFACE_MODE_INVALID", {}))
    return tuple(results)


def _surface_denial_reason(config: SyntheticMvpConfig, surfaces: tuple[SurfaceResult, ...]) -> str | None:
    required = {
        "terminal": config.terminal_surface_required,
        "code_execution": config.code_execution_surface_required,
        "delegate_task": config.delegate_task_surface_required,
        "mcp": config.mcp_surface_required,
    }
    for surface in surfaces:
        if surface.mode not in FAKE_OR_FAIL_CLOSED_MODES:
            return f"SURFACE_MODE_INVALID:{surface.name}"
        if required[surface.name] and surface.mode not in FAKE_OR_FAIL_CLOSED_MODES:
            return f"SURFACE_NOT_FAKE_OR_FAIL_CLOSED:{surface.name}"
    return None


def _deny(
    reason: str,
    *,
    sanitized_environment: SanitizedEnvironment | None = None,
    surface_results: tuple[SurfaceResult, ...] = (),
) -> SyntheticMvpDecision:
    return SyntheticMvpDecision(
        allowed=False,
        reason=reason,
        sanitized_environment=sanitized_environment,
        surface_results=surface_results,
    )
