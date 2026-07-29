"""Disabled-by-default runtime integration contracts for Phase 1E.

This module is a local contract layer only. It does not import Hermes runtime
code, start subprocesses, create sandboxes, call network/provider APIs, read
process environment, read auth files, access Keychain, or write credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_launch_contracts import (
    EMPTY_RUNTIME_ENVIRONMENT,
    ProfileEnvironmentPolicy,
    RuntimeLaunchContext,
    RuntimeSanitizedEnvironment,
    build_child_environment,
    prepare_runtime_launch,
)


CHILD_SURFACES = frozenset({"terminal", "code_execution", "delegate_task", "mcp", "background_process"})


@dataclass(frozen=True)
class RuntimeIntegrationConfig:
    """Disabled-by-default integration controls."""

    integration_enabled: bool = False
    runtime_launch_enabled: bool = False
    broker_channel_enabled: bool = False
    audit_required: bool = True


@dataclass(frozen=True)
class RuntimeIntegrationRequest:
    """Explicit request for preparing runtime integration state.

    `source_environment` must be supplied by the caller. The contract never
    reads process environment or discovers runtime state by itself.
    """

    context: RuntimeLaunchContext
    profile_environment_policy: ProfileEnvironmentPolicy
    source_environment: Mapping[str, object] | None
    child_surfaces: tuple[str, ...]
    credential_grant_refs: tuple[str, ...]
    model_broker_required: bool = True


@dataclass(frozen=True)
class RuntimeIntegrationDecision:
    allowed: bool
    reason: str
    lifecycle_state: str
    child_environments: Mapping[str, RuntimeSanitizedEnvironment]
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False


def prepare_disabled_runtime_integration(
    *,
    request: RuntimeIntegrationRequest,
    config: RuntimeIntegrationConfig | None = None,
    audit_sink: AuditSinkState,
    broker_available: bool,
) -> RuntimeIntegrationDecision:
    """Prepare disabled runtime integration state without executing runtime."""

    resolved_config = config or RuntimeIntegrationConfig()
    if not resolved_config.integration_enabled:
        return _deny("RUNTIME_INTEGRATION_DISABLED", "requested")
    if resolved_config.runtime_launch_enabled:
        return _deny("RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_CONTRACT", "requested")
    if not resolved_config.broker_channel_enabled and request.model_broker_required:
        return _deny("BROKER_CHANNEL_DISABLED", "requested")
    if resolved_config.audit_required and not audit_sink.available:
        return _deny("AUDIT_UNAVAILABLE", "requested")
    validation_reason = _validate_request(request)
    if validation_reason is not None:
        return _deny(validation_reason, "requested")

    launch_decision = prepare_runtime_launch(
        source_environment=request.source_environment,
        profile_policy=request.profile_environment_policy,
        context=request.context,
        audit_available=audit_sink.available,
        broker_available=broker_available,
    )
    if launch_decision.reason not in {"RUNTIME_LAUNCH_NOT_IMPLEMENTED", "SANITIZER_DENIED_SENSITIVE_KEY"}:
        return _deny(launch_decision.reason, launch_decision.lifecycle_state)
    child_envs = {
        surface: build_child_environment(
            source_environment=request.source_environment,
            profile_policy=request.profile_environment_policy,
            context=request.context,
        )
        for surface in request.child_surfaces
    }
    denied_surfaces = tuple(sorted(surface for surface, env in child_envs.items() if env.denied_keys))
    if denied_surfaces:
        return RuntimeIntegrationDecision(
            allowed=False,
            reason="CHILD_ENVIRONMENT_DENIED_SENSITIVE_KEY",
            lifecycle_state="environment_sanitized",
            child_environments=child_envs,
        )
    return RuntimeIntegrationDecision(
        allowed=False,
        reason="DISABLED_RUNTIME_INTEGRATION_CONTRACT_READY_NO_RUNTIME_STARTED",
        lifecycle_state="grant_refs_attached",
        child_environments=child_envs,
    )


def _validate_request(request: RuntimeIntegrationRequest) -> str | None:
    if request.profile_environment_policy.profile_id != request.context.profile_id:
        return "PROFILE_POLICY_MISMATCH"
    if not request.child_surfaces:
        return "CHILD_SURFACES_MISSING"
    unknown = sorted(surface for surface in request.child_surfaces if surface not in CHILD_SURFACES)
    if unknown:
        return f"CHILD_SURFACE_UNSUPPORTED:{unknown[0]}"
    if len(set(request.child_surfaces)) != len(request.child_surfaces):
        return "CHILD_SURFACE_DUPLICATE"
    if request.credential_grant_refs != request.context.grant_refs:
        return "CREDENTIAL_GRANT_REFS_CONTEXT_MISMATCH"
    if not request.credential_grant_refs:
        return "CREDENTIAL_GRANT_REFS_MISSING"
    if not all(isinstance(grant_ref, str) and grant_ref.startswith("grant_ref_") for grant_ref in request.credential_grant_refs):
        return "CREDENTIAL_GRANT_REF_INVALID"
    return None


def _deny(reason: str, lifecycle_state: str) -> RuntimeIntegrationDecision:
    return RuntimeIntegrationDecision(False, reason, lifecycle_state, {}, False, False, False, False, False, False)
