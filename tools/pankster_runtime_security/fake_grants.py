"""Synthetic-only fake grant registry for Phase 1D tests."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Mapping
GRANT_ID_PREFIX = "grant_opaque_"


@dataclass(frozen=True)
class FakeGrant:
    """A non-secret grant reference bound to one synthetic attempt."""

    grant_id: str
    profile_id: str
    workflow_id: str
    task_id: str
    attempt_id: str
    purpose: str
    provider_family: str
    model_allowlist: tuple[str, ...]
    operation_allowlist: tuple[str, ...]
    ttl_seconds: int
    budget_requests_remaining: int
    policy_version: str
    runtime_identity_hash: str
    network_policy_id: str
    expired: bool = False
    used_sequences: tuple[str, ...] = ()


@dataclass(frozen=True)
class GrantDecision:
    """Secret-free grant decision."""

    allowed: bool
    reason: str
    grant: FakeGrant | None = None


class FakeGrantRegistry:
    """In-memory synthetic grant registry.

    This class is deliberately fake and local. It performs no credential lookup,
    auth-store access, network calls, filesystem writes, or provider work.
    """

    def __init__(self) -> None:
        self._grants: dict[str, FakeGrant] = {}
        self._next_grant_number = 0

    def issue_grant(
        self,
        *,
        profile_id: str,
        workflow_id: str,
        task_id: str,
        attempt_id: str,
        purpose: str,
        provider_family: str,
        model_allowlist: tuple[str, ...],
        operation_allowlist: tuple[str, ...],
        ttl_seconds: int,
        budget_requests: int,
        policy_version: str,
        runtime_identity_hash: str,
        network_policy_id: str,
    ) -> GrantDecision:
        if ttl_seconds <= 0:
            return GrantDecision(False, "INVALID_TTL")
        if budget_requests < 0:
            return GrantDecision(False, "INVALID_BUDGET")
        if not model_allowlist:
            return GrantDecision(False, "EMPTY_MODEL_ALLOWLIST")
        if not operation_allowlist:
            return GrantDecision(False, "EMPTY_OPERATION_ALLOWLIST")
        grant_id = f"{GRANT_ID_PREFIX}{self._next_grant_number:032x}"
        self._next_grant_number += 1
        grant = FakeGrant(
            grant_id=grant_id,
            profile_id=profile_id,
            workflow_id=workflow_id,
            task_id=task_id,
            attempt_id=attempt_id,
            purpose=purpose,
            provider_family=provider_family,
            model_allowlist=tuple(model_allowlist),
            operation_allowlist=tuple(operation_allowlist),
            ttl_seconds=ttl_seconds,
            budget_requests_remaining=budget_requests,
            policy_version=policy_version,
            runtime_identity_hash=runtime_identity_hash,
            network_policy_id=network_policy_id,
        )
        self._grants[grant.grant_id] = grant
        return GrantDecision(True, "GRANT_ISSUED", grant)

    def validate_for_request(
        self,
        *,
        grant_id: str,
        profile_id: str,
        task_id: str,
        attempt_id: str,
        runtime_identity_hash: str,
        provider_family: str,
        model: str,
        operation: str,
        sequence_id: str,
    ) -> GrantDecision:
        grant = self._grants.get(grant_id)
        if grant is None:
            return GrantDecision(False, "GRANT_MISSING")
        if grant.expired:
            return GrantDecision(False, "GRANT_EXPIRED")
        if grant.profile_id != profile_id:
            return GrantDecision(False, "GRANT_PROFILE_MISMATCH")
        if grant.task_id != task_id:
            return GrantDecision(False, "GRANT_TASK_MISMATCH")
        if grant.attempt_id != attempt_id:
            return GrantDecision(False, "GRANT_ATTEMPT_MISMATCH")
        if grant.runtime_identity_hash != runtime_identity_hash:
            return GrantDecision(False, "RUNTIME_IDENTITY_MISMATCH")
        if grant.provider_family != provider_family:
            return GrantDecision(False, "PROVIDER_FAMILY_NOT_ALLOWLISTED")
        if model not in grant.model_allowlist:
            return GrantDecision(False, "MODEL_NOT_ALLOWLISTED")
        if operation not in grant.operation_allowlist:
            return GrantDecision(False, "OPERATION_NOT_ALLOWLISTED")
        if sequence_id in grant.used_sequences:
            return GrantDecision(False, "GRANT_REPLAY_DETECTED")
        if grant.budget_requests_remaining <= 0:
            return GrantDecision(False, "BUDGET_EXCEEDED")

        updated = replace(
            grant,
            budget_requests_remaining=grant.budget_requests_remaining - 1,
            used_sequences=tuple(sorted((*grant.used_sequences, sequence_id))),
        )
        self._grants[grant_id] = updated
        return GrantDecision(True, "GRANT_ACCEPTED", updated)

    def expire(self, grant_id: str) -> bool:
        grant = self._grants.get(grant_id)
        if grant is None:
            return False
        self._grants[grant_id] = replace(grant, expired=True)
        return True

    def snapshot(self) -> Mapping[str, FakeGrant]:
        return dict(self._grants)
