"""Pure runtime adapter contracts and fail-closed stubs for Phase 1D."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from tools.pankster_runtime_security.environment_sanitizer import SanitizedEnvironment, sanitize_environment


@dataclass(frozen=True)
class RuntimeSecurityContext:
    """Secret-free runtime identity and grant context."""

    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    policy_version: str
    runtime_identity_hash: str
    network_policy_id: str
    grant_ids: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeAdapterConfig:
    """Disabled-by-default adapter controls."""

    adapter_enabled: bool = False
    broker_channel_enabled: bool = False
    sandbox_launch_enabled: bool = False


@dataclass(frozen=True)
class RuntimeLaunchRequest:
    """Explicit launch preparation request.

    `source_environment` must be supplied by the caller. The adapter stub never
    reads process environment, env files, auth stores, Keychain, or runtime state.
    """

    context: RuntimeSecurityContext
    source_environment: Mapping[str, object] | None
    command: tuple[str, ...] = ()


@dataclass(frozen=True)
class BrokerForwardRequest:
    """Secret-free broker forward request contract."""

    context: RuntimeSecurityContext
    grant_id: str
    operation: str
    sequence_id: str
    payload_hash: str


@dataclass(frozen=True)
class RuntimeAdapterDecision:
    """Fail-closed adapter decision."""

    allowed: bool
    reason: str
    sanitized_environment: SanitizedEnvironment
    sandbox_started: bool
    broker_channel_started: bool


EMPTY_SANITIZED_ENVIRONMENT = SanitizedEnvironment({}, (), ())


class RuntimeAdapterStub:
    """A pure fail-closed adapter stub.

    This class deliberately performs no sandbox launch, subprocess execution,
    broker transport, filesystem writes, network calls, provider work, or
    credential reads. It exists only to lock typed contracts before runtime work.
    """

    def __init__(self, config: RuntimeAdapterConfig | None = None) -> None:
        self._config = config or RuntimeAdapterConfig()

    def prepare_launch(self, request: RuntimeLaunchRequest) -> RuntimeAdapterDecision:
        if not self._config.adapter_enabled:
            return _deny("RUNTIME_ADAPTER_DISABLED")
        context_reason = _context_denial_reason(request.context)
        if context_reason is not None:
            return _deny(context_reason)
        if not request.command:
            return _deny("RUNTIME_COMMAND_MISSING")

        sanitized = sanitize_environment(
            {
                **dict(request.source_environment or {}),
                "PANKSTER_PROFILE_ID": request.context.profile_id,
                "PANKSTER_WORKFLOW_ID": request.context.workflow_id,
                "PANKSTER_TASK_ID": request.context.task_id,
                "PANKSTER_ATTEMPT_ID": request.context.attempt_id,
                "PANKSTER_POLICY_VERSION": request.context.policy_version,
                "PANKSTER_GRANT_IDS": ",".join(request.context.grant_ids),
                "PANKSTER_NETWORK_POLICY": request.context.network_policy_id,
                "PANKSTER_BROKER_MODE": "host-broker-required",
            }
        )
        return RuntimeAdapterDecision(
            allowed=False,
            reason="SANDBOX_LAUNCH_NOT_IMPLEMENTED",
            sanitized_environment=sanitized,
            sandbox_started=False,
            broker_channel_started=False,
        )

    def forward_to_broker(self, request: BrokerForwardRequest) -> RuntimeAdapterDecision:
        if not self._config.adapter_enabled:
            return _deny("RUNTIME_ADAPTER_DISABLED")
        if not self._config.broker_channel_enabled:
            return _deny("BROKER_CHANNEL_DISABLED")
        context_reason = _context_denial_reason(request.context)
        if context_reason is not None:
            return _deny(context_reason)
        if request.grant_id not in request.context.grant_ids:
            return _deny("GRANT_NOT_BOUND_TO_CONTEXT")
        if not _is_nonempty(request.operation):
            return _deny("BROKER_OPERATION_MISSING")
        if not _is_nonempty(request.sequence_id):
            return _deny("BROKER_SEQUENCE_MISSING")
        if not _is_nonempty(request.payload_hash):
            return _deny("BROKER_PAYLOAD_HASH_MISSING")
        return _deny("BROKER_CHANNEL_NOT_IMPLEMENTED")


def _deny(reason: str) -> RuntimeAdapterDecision:
    return RuntimeAdapterDecision(
        allowed=False,
        reason=reason,
        sanitized_environment=EMPTY_SANITIZED_ENVIRONMENT,
        sandbox_started=False,
        broker_channel_started=False,
    )


def _context_denial_reason(context: RuntimeSecurityContext) -> str | None:
    required_fields = (
        ("profile_id", context.profile_id),
        ("workflow_id", context.workflow_id),
        ("task_id", context.task_id),
        ("attempt_id", context.attempt_id),
        ("policy_version", context.policy_version),
        ("runtime_identity_hash", context.runtime_identity_hash),
        ("network_policy_id", context.network_policy_id),
    )
    for field, value in required_fields:
        if not _is_nonempty(value):
            return f"RUNTIME_CONTEXT_FIELD_MISSING:{field}"
    if not context.grant_ids:
        return "RUNTIME_GRANT_MISSING"
    if not all(_is_nonempty(grant_id) for grant_id in context.grant_ids):
        return "RUNTIME_GRANT_INVALID"
    return None


def _is_nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
