"""Pure model broker contracts for Phase 1E runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha256
from typing import Mapping

from tools.pankster_runtime_security.audit_contracts import AuditContext, AuditEvent, AuditSinkState, validate_audit_event
from tools.pankster_runtime_security.credential_broker_contracts import CredentialGrant
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


@dataclass(frozen=True)
class ModelBrokerRequest:
    grant_id: str
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    provider_family: str
    model: str
    operation: str
    sequence_id: str
    idempotency_key: str
    payload_ref_or_hash: str
    audit_context: Mapping[str, str]


@dataclass(frozen=True)
class ModelBrokerResponse:
    allowed: bool
    reason: str
    sanitized_output_ref_or_payload: str | None
    usage: Mapping[str, int]
    finish_reason: str | None
    audit_event_id: str | None
    grant_usage_hash: str | None
    updated_grant: CredentialGrant | None = None


def prepare_model_provider_call(
    *,
    request: ModelBrokerRequest,
    grant: CredentialGrant | None,
    audit_sink: AuditSinkState,
    used_sequences: tuple[str, ...] = (),
    credential_broker_available: bool = True,
) -> ModelBrokerResponse:
    """Validate policy/grant/audit before a provider boundary.

    This function never calls a provider, network client, subprocess, auth
    store, Keychain, or process environment.
    """

    if not credential_broker_available:
        return _deny("CREDENTIAL_BROKER_UNAVAILABLE")
    if grant is None:
        return _deny("GRANT_MISSING")
    request_reason = _request_denial_reason(request, grant, used_sequences)
    if request_reason is not None:
        return _deny(request_reason)
    scan = scan_secret_shapes({"payload_ref_or_hash": request.payload_ref_or_hash, "audit_context": dict(request.audit_context)})
    if not scan.allowed:
        return _deny("MODEL_REQUEST_SECRET_SCAN_FAILED")
    audit = validate_audit_event(
        AuditEvent(
            event_type="model.requested",
            context=AuditContext(
                profile_id=request.profile_id,
                workflow_id=request.workflow_id,
                task_id=request.task_id,
                attempt_id=request.attempt_id,
                runtime_identity_hash=request.runtime_identity_hash,
                policy_version=grant.policy_version,
            ),
            reason="model broker provider boundary prepared",
            metadata={"grant_id": request.grant_id, "provider_family": request.provider_family, "model": request.model, "operation": request.operation},
        ),
        audit_sink,
    )
    if not audit.allowed or audit.audit_event_id is None:
        return _deny(audit.reason)
    updated_grant = replace(grant, budget_requests_remaining=grant.budget_requests_remaining - 1)
    usage_hash = sha256(f"{grant.grant_id}|{request.sequence_id}|{updated_grant.budget_requests_remaining}".encode("utf-8")).hexdigest()
    return ModelBrokerResponse(
        allowed=True,
        reason="PROVIDER_BOUNDARY_READY_NO_CALL_PERFORMED",
        sanitized_output_ref_or_payload=None,
        usage={"requests_reserved": 1},
        finish_reason=None,
        audit_event_id=audit.audit_event_id,
        grant_usage_hash=usage_hash,
        updated_grant=updated_grant,
    )


def sanitize_provider_error(error: object) -> str:
    """Return a bounded secret-free provider error class."""

    class_name = error.__class__.__name__ if error is not None else "UnknownError"
    scan = scan_secret_shapes(class_name)
    if not scan.allowed:
        return "ProviderError"
    return class_name[:80] or "ProviderError"


def _request_denial_reason(request: ModelBrokerRequest, grant: CredentialGrant, used_sequences: tuple[str, ...]) -> str | None:
    for field, value in (
        ("grant_id", request.grant_id),
        ("profile_id", request.profile_id),
        ("workflow_id", request.workflow_id),
        ("task_id", request.task_id),
        ("attempt_id", request.attempt_id),
        ("runtime_identity_hash", request.runtime_identity_hash),
        ("provider_family", request.provider_family),
        ("model", request.model),
        ("operation", request.operation),
        ("sequence_id", request.sequence_id),
        ("idempotency_key", request.idempotency_key),
        ("payload_ref_or_hash", request.payload_ref_or_hash),
    ):
        if not isinstance(value, str) or not value.strip():
            return f"MODEL_REQUEST_FIELD_MISSING:{field}"
    if request.grant_id != grant.grant_id:
        return "GRANT_ID_MISMATCH"
    if request.profile_id != grant.profile_id:
        return "PROFILE_MISMATCH"
    if request.workflow_id != grant.workflow_id:
        return "WORKFLOW_MISMATCH"
    if request.task_id != grant.task_id:
        return "TASK_MISMATCH"
    if request.attempt_id != grant.attempt_id:
        return "ATTEMPT_MISMATCH"
    if request.runtime_identity_hash != grant.runtime_identity_hash:
        return "RUNTIME_IDENTITY_MISMATCH"
    if request.provider_family != grant.provider_family:
        return "PROVIDER_FAMILY_NOT_ALLOWLISTED"
    if request.model not in grant.model_allowlist:
        return "MODEL_NOT_ALLOWLISTED"
    if request.operation not in grant.operation_allowlist:
        return "OPERATION_NOT_ALLOWLISTED"
    if request.sequence_id in used_sequences:
        return "REPLAY_DETECTED"
    if grant.budget_requests_remaining <= 0:
        return "BUDGET_EXCEEDED"
    return None


def _deny(reason: str) -> ModelBrokerResponse:
    return ModelBrokerResponse(
        allowed=False,
        reason=reason,
        sanitized_output_ref_or_payload=None,
        usage={},
        finish_reason=None,
        audit_event_id=None,
        grant_usage_hash=None,
    )
