"""Pure credential broker contracts for Phase 1E runtime-security gates."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Mapping

from tools.pankster_runtime_security.audit_contracts import AuditContext, AuditEvent, AuditSinkState, validate_audit_event
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


GRANT_ID_PREFIX = "grant_ref_"
MAX_GRANT_TTL_SECONDS = 900


@dataclass(frozen=True)
class CredentialReference:
    credential_ref_id: str
    owner_principal_id: str
    provider_family: str
    allowed_profiles: tuple[str, ...]
    allowed_operations: tuple[str, ...]
    rotation_epoch: str
    policy_version: str
    status: str
    metadata: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class CredentialGrantRequest:
    profile_id: str
    owner_principal_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    policy_version: str
    purpose: str
    provider_family: str
    model_allowlist: tuple[str, ...]
    operation_allowlist: tuple[str, ...]
    ttl_seconds: int
    budget_requests: int
    sequence_policy: str


@dataclass(frozen=True)
class CredentialGrant:
    grant_id: str
    credential_ref_id: str
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    policy_version: str
    purpose: str
    provider_family: str
    model_allowlist: tuple[str, ...]
    operation_allowlist: tuple[str, ...]
    ttl_seconds: int
    budget_requests_remaining: int
    sequence_policy: str
    audit_event_id: str


@dataclass(frozen=True)
class CredentialBrokerDecision:
    allowed: bool
    reason: str
    grant: CredentialGrant | None = None
    audit_event_id: str | None = None


@dataclass(frozen=True)
class OAuthRefreshRequest:
    actor_kind: str
    owner_principal_id: str
    credential_ref_id: str
    expected_rotation_epoch: str
    new_rotation_epoch: str


def validate_credential_reference(reference: CredentialReference) -> CredentialBrokerDecision:
    scan = scan_secret_shapes({"credential_reference": _reference_public_dict(reference)})
    if not scan.allowed:
        return CredentialBrokerDecision(False, "CREDENTIAL_REFERENCE_SECRET_FIELD")
    for field, value in (
        ("credential_ref_id", reference.credential_ref_id),
        ("owner_principal_id", reference.owner_principal_id),
        ("provider_family", reference.provider_family),
        ("rotation_epoch", reference.rotation_epoch),
        ("policy_version", reference.policy_version),
        ("status", reference.status),
    ):
        if not _nonempty(value):
            return CredentialBrokerDecision(False, f"CREDENTIAL_REFERENCE_FIELD_MISSING:{field}")
    if reference.status != "active":
        return CredentialBrokerDecision(False, "CREDENTIAL_REFERENCE_INACTIVE")
    if not reference.allowed_profiles:
        return CredentialBrokerDecision(False, "CREDENTIAL_REFERENCE_PROFILE_ALLOWLIST_EMPTY")
    if not reference.allowed_operations:
        return CredentialBrokerDecision(False, "CREDENTIAL_REFERENCE_OPERATION_ALLOWLIST_EMPTY")
    return CredentialBrokerDecision(True, "CREDENTIAL_REFERENCE_ACCEPTED")


def issue_credential_grant(
    *,
    reference: CredentialReference,
    request: CredentialGrantRequest,
    audit_sink: AuditSinkState,
    root_auth_fallback_enabled: bool = False,
    root_pool_materialization_requested: bool = False,
) -> CredentialBrokerDecision:
    """Issue an opaque grant reference without materializing credentials."""

    if root_auth_fallback_enabled:
        return CredentialBrokerDecision(False, "ROOT_AUTH_FALLBACK_DISABLED_FOR_NAMED_PROFILE")
    if root_pool_materialization_requested:
        return CredentialBrokerDecision(False, "ROOT_CREDENTIAL_POOL_MATERIALIZATION_FORBIDDEN")
    reference_decision = validate_credential_reference(reference)
    if not reference_decision.allowed:
        return reference_decision
    request_reason = _grant_request_reason(reference, request)
    if request_reason is not None:
        return CredentialBrokerDecision(False, request_reason)
    audit = validate_audit_event(
        AuditEvent(
            event_type="grant.issued",
            context=AuditContext(
                profile_id=request.profile_id,
                workflow_id=request.workflow_id,
                task_id=request.task_id,
                attempt_id=request.attempt_id,
                runtime_identity_hash=request.runtime_identity_hash,
                policy_version=request.policy_version,
            ),
            reason="credential grant issued",
            metadata={"credential_ref_id": reference.credential_ref_id, "provider_family": request.provider_family, "purpose": request.purpose},
        ),
        audit_sink,
    )
    if not audit.allowed or audit.audit_event_id is None:
        return CredentialBrokerDecision(False, audit.reason)
    grant = CredentialGrant(
        grant_id=_grant_id(reference, request, audit.audit_event_id),
        credential_ref_id=reference.credential_ref_id,
        profile_id=request.profile_id,
        workflow_id=request.workflow_id,
        task_id=request.task_id,
        attempt_id=request.attempt_id,
        runtime_identity_hash=request.runtime_identity_hash,
        policy_version=request.policy_version,
        purpose=request.purpose,
        provider_family=request.provider_family,
        model_allowlist=tuple(request.model_allowlist),
        operation_allowlist=tuple(request.operation_allowlist),
        ttl_seconds=request.ttl_seconds,
        budget_requests_remaining=request.budget_requests,
        sequence_policy=request.sequence_policy,
        audit_event_id=audit.audit_event_id,
    )
    return CredentialBrokerDecision(True, "GRANT_REFERENCE_ISSUED", grant=grant, audit_event_id=audit.audit_event_id)


def validate_oauth_refresh_request(request: OAuthRefreshRequest, reference: CredentialReference) -> CredentialBrokerDecision:
    if request.actor_kind != "owner":
        return CredentialBrokerDecision(False, "OAUTH_REFRESH_OWNER_ONLY")
    if request.owner_principal_id != reference.owner_principal_id:
        return CredentialBrokerDecision(False, "OAUTH_REFRESH_OWNER_MISMATCH")
    if request.credential_ref_id != reference.credential_ref_id:
        return CredentialBrokerDecision(False, "OAUTH_REFRESH_CREDENTIAL_REF_MISMATCH")
    if request.expected_rotation_epoch != reference.rotation_epoch:
        return CredentialBrokerDecision(False, "OAUTH_REFRESH_COMPARE_AND_SWAP_FAILED")
    if not _nonempty(request.new_rotation_epoch) or request.new_rotation_epoch == request.expected_rotation_epoch:
        return CredentialBrokerDecision(False, "OAUTH_REFRESH_ROTATION_EPOCH_INVALID")
    return CredentialBrokerDecision(True, "OAUTH_REFRESH_REQUEST_ACCEPTED_NO_SECRET_WRITE")


def _grant_request_reason(reference: CredentialReference, request: CredentialGrantRequest) -> str | None:
    for field, value in (
        ("profile_id", request.profile_id),
        ("owner_principal_id", request.owner_principal_id),
        ("workflow_id", request.workflow_id),
        ("task_id", request.task_id),
        ("attempt_id", request.attempt_id),
        ("runtime_identity_hash", request.runtime_identity_hash),
        ("policy_version", request.policy_version),
        ("purpose", request.purpose),
        ("provider_family", request.provider_family),
        ("sequence_policy", request.sequence_policy),
    ):
        if not _nonempty(value):
            return f"GRANT_REQUEST_FIELD_MISSING:{field}"
    if request.owner_principal_id != reference.owner_principal_id:
        return "CREDENTIAL_REF_OWNER_MISMATCH"
    if request.profile_id not in reference.allowed_profiles:
        return "PROFILE_NOT_ALLOWED_FOR_CREDENTIAL_REF"
    if request.provider_family != reference.provider_family:
        return "PROVIDER_FAMILY_MISMATCH"
    if not request.operation_allowlist:
        return "OPERATION_ALLOWLIST_EMPTY"
    if any(operation not in reference.allowed_operations for operation in request.operation_allowlist):
        return "OPERATION_NOT_ALLOWED_FOR_CREDENTIAL_REF"
    if not request.model_allowlist:
        return "MODEL_ALLOWLIST_EMPTY"
    if not isinstance(request.ttl_seconds, int) or isinstance(request.ttl_seconds, bool) or not 0 < request.ttl_seconds <= MAX_GRANT_TTL_SECONDS:
        return "GRANT_TTL_INVALID"
    if not isinstance(request.budget_requests, int) or isinstance(request.budget_requests, bool) or request.budget_requests < 1:
        return "GRANT_BUDGET_INVALID"
    return None


def _reference_public_dict(reference: CredentialReference) -> dict[str, Any]:
    return {
        "credential_ref_id": reference.credential_ref_id,
        "owner_principal_id": reference.owner_principal_id,
        "provider_family": reference.provider_family,
        "allowed_profiles": reference.allowed_profiles,
        "allowed_operations": reference.allowed_operations,
        "rotation_epoch": reference.rotation_epoch,
        "policy_version": reference.policy_version,
        "status": reference.status,
        "metadata": dict(reference.metadata or {}),
    }


def _grant_id(reference: CredentialReference, request: CredentialGrantRequest, audit_event_id: str) -> str:
    digest = sha256(
        "|".join(
            (
                reference.credential_ref_id,
                request.profile_id,
                request.workflow_id,
                request.task_id,
                request.attempt_id,
                request.runtime_identity_hash,
                request.policy_version,
                request.purpose,
                audit_event_id,
            )
        ).encode("utf-8")
    ).hexdigest()
    return f"{GRANT_ID_PREFIX}{digest}"


def _nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())
