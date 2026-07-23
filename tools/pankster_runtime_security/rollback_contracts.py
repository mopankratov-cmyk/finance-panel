"""Pure rollback contracts for Phase 1E runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass, replace

from tools.pankster_runtime_security.audit_contracts import AuditContext, AuditEvent, AuditSinkState, validate_audit_event


@dataclass(frozen=True)
class RuntimeRollbackState:
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    policy_version: str
    runtime_started: bool
    new_grants_allowed: bool
    active_grant_refs: tuple[str, ...]
    revoked_grant_refs: tuple[str, ...] = ()
    gateway_changed: bool = False


@dataclass(frozen=True)
class RollbackDecision:
    allowed: bool
    reason: str
    state: RuntimeRollbackState
    audit_event_id: str | None = None


def deny_new_grants(state: RuntimeRollbackState) -> RuntimeRollbackState:
    return replace(state, new_grants_allowed=False)


def revoke_attempt_grants(state: RuntimeRollbackState) -> RuntimeRollbackState:
    revoked = tuple(sorted(set(state.revoked_grant_refs).union(state.active_grant_refs)))
    return replace(state, active_grant_refs=(), revoked_grant_refs=revoked)


def rollback_named_profile_runtime(state: RuntimeRollbackState, audit_sink: AuditSinkState) -> RollbackDecision:
    """Rollback without gateway mutation or process control side effects."""

    context_reason = _state_reason(state)
    if context_reason is not None:
        return RollbackDecision(False, context_reason, state)
    if not audit_sink.available:
        return RollbackDecision(False, "ROLLBACK_AUDIT_UNAVAILABLE", deny_new_grants(state))
    rolled_back = revoke_attempt_grants(deny_new_grants(state))
    rolled_back = replace(rolled_back, runtime_started=False, gateway_changed=False)
    audit = validate_audit_event(
        AuditEvent(
            event_type="rollback.completed",
            context=AuditContext(
                profile_id=rolled_back.profile_id,
                workflow_id=rolled_back.workflow_id,
                task_id=rolled_back.task_id,
                attempt_id=rolled_back.attempt_id,
                runtime_identity_hash=rolled_back.runtime_identity_hash,
                policy_version=rolled_back.policy_version,
            ),
            reason="rollback completed without gateway change",
            metadata={"revoked_grant_count": len(rolled_back.revoked_grant_refs), "runtime_started": rolled_back.runtime_started},
        ),
        audit_sink,
    )
    if not audit.allowed or audit.audit_event_id is None:
        return RollbackDecision(False, audit.reason, rolled_back)
    return RollbackDecision(True, "ROLLBACK_COMPLETED", rolled_back, audit.audit_event_id)


def _state_reason(state: RuntimeRollbackState) -> str | None:
    for field, value in (
        ("profile_id", state.profile_id),
        ("workflow_id", state.workflow_id),
        ("task_id", state.task_id),
        ("attempt_id", state.attempt_id),
        ("runtime_identity_hash", state.runtime_identity_hash),
        ("policy_version", state.policy_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"ROLLBACK_CONTEXT_FIELD_MISSING:{field}"
    return None
