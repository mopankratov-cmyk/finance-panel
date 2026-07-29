"""Synthetic-only fake model broker for Phase 1D tests."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

from tools.pankster_runtime_security.fake_grants import FakeGrantRegistry


@dataclass(frozen=True)
class FakeModelRequest:
    grant_id: str
    profile_id: str
    task_id: str
    attempt_id: str
    runtime_identity_hash: str
    provider_family: str
    model: str
    operation: str
    sequence_id: str
    input_payload_hash: str


@dataclass(frozen=True)
class FakeModelResponse:
    allowed: bool
    reason: str
    result_payload: str | None
    usage: dict[str, int]
    audit_event_id: str
    grant_usage_hash: str | None


class FakeModelBroker:
    """Host-side fake broker with no provider SDKs or network clients."""

    def __init__(self, registry: FakeGrantRegistry) -> None:
        self._registry = registry

    def complete(self, request: FakeModelRequest) -> FakeModelResponse:
        decision = self._registry.validate_for_request(
            grant_id=request.grant_id,
            profile_id=request.profile_id,
            task_id=request.task_id,
            attempt_id=request.attempt_id,
            runtime_identity_hash=request.runtime_identity_hash,
            provider_family=request.provider_family,
            model=request.model,
            operation=request.operation,
            sequence_id=request.sequence_id,
        )
        audit_event_id = _stable_event_id(request, decision.reason)
        if not decision.allowed or decision.grant is None:
            return FakeModelResponse(False, decision.reason, None, {"requests": 0}, audit_event_id, None)

        usage_hash = sha256(f"{decision.grant.grant_id}:{request.sequence_id}:{decision.grant.budget_requests_remaining}".encode("utf-8")).hexdigest()
        payload = f"synthetic_result:{request.model}:{request.operation}:{request.input_payload_hash[:12]}"
        return FakeModelResponse(True, "FAKE_MODEL_COMPLETED", payload, {"requests": 1}, audit_event_id, usage_hash)


def _stable_event_id(request: FakeModelRequest, reason: str) -> str:
    digest = sha256(
        ":".join(
            (
                request.grant_id,
                request.profile_id,
                request.task_id,
                request.attempt_id,
                request.sequence_id,
                reason,
            )
        ).encode("utf-8")
    ).hexdigest()
    return f"audit_fake_{digest[:32]}"
