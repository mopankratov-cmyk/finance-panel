"""Pure audit contracts for Phase 1E runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Mapping

from tools.pankster_runtime_security.secret_scan import SecretFinding, scan_secret_shapes


REQUIRED_AUDIT_EVENTS = frozenset(
    {
        "policy.checked",
        "grant.requested",
        "grant.issued",
        "grant.denied",
        "grant.used",
        "model.requested",
        "model.denied",
        "model.completed",
        "model.failed",
        "runtime.launch.requested",
        "runtime.launch.denied",
        "runtime.launch.started",
        "runtime.destroy.requested",
        "runtime.destroyed",
        "rollback.requested",
        "rollback.completed",
        "credential.refresh.requested",
        "credential.refresh.denied",
        "credential.refresh.completed",
    }
)


@dataclass(frozen=True)
class AuditContext:
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    policy_version: str


@dataclass(frozen=True)
class AuditEvent:
    event_type: str
    context: AuditContext
    reason: str
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class AuditValidation:
    allowed: bool
    reason: str
    audit_event_id: str | None = None
    findings: tuple[SecretFinding, ...] = ()


@dataclass(frozen=True)
class AuditSinkState:
    available: bool
    write_succeeds: bool = True


def validate_audit_event(event: AuditEvent, sink: AuditSinkState) -> AuditValidation:
    """Validate that an audit event can be written without leaking secrets."""

    if not sink.available:
        return AuditValidation(False, "AUDIT_UNAVAILABLE")
    if event.event_type not in REQUIRED_AUDIT_EVENTS:
        return AuditValidation(False, "AUDIT_EVENT_TYPE_INVALID")
    context_reason = _context_reason(event.context)
    if context_reason is not None:
        return AuditValidation(False, context_reason)
    scan = scan_secret_shapes({"reason": event.reason, "metadata": dict(event.metadata)})
    if not scan.allowed:
        return AuditValidation(False, "AUDIT_SECRET_SCAN_FAILED", findings=scan.findings)
    if not sink.write_succeeds:
        return AuditValidation(False, "AUDIT_WRITE_FAILED")
    return AuditValidation(True, "AUDIT_ACCEPTED", audit_event_id=derive_audit_event_id(event))


def derive_audit_event_id(event: AuditEvent) -> str:
    basis = "|".join(
        (
            event.event_type,
            event.context.profile_id,
            event.context.workflow_id,
            event.context.task_id,
            event.context.attempt_id,
            event.context.runtime_identity_hash,
            event.context.policy_version,
            event.reason,
        )
    )
    return f"audit_{sha256(basis.encode('utf-8')).hexdigest()[:32]}"


def _context_reason(context: AuditContext) -> str | None:
    for field, value in (
        ("profile_id", context.profile_id),
        ("workflow_id", context.workflow_id),
        ("task_id", context.task_id),
        ("attempt_id", context.attempt_id),
        ("runtime_identity_hash", context.runtime_identity_hash),
        ("policy_version", context.policy_version),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"AUDIT_CONTEXT_FIELD_MISSING:{field}"
    return None
