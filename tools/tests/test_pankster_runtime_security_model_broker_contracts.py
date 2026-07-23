import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.credential_broker_contracts import CredentialGrant
from tools.pankster_runtime_security.model_broker_contracts import ModelBrokerRequest, prepare_model_provider_call, sanitize_provider_error


def grant(**overrides):
    values = {
        "grant_id": "grant_ref_abc",
        "credential_ref_id": "cred_ref_openai_primary",
        "profile_id": "dev-director",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "policy_version": "policy-v1",
        "purpose": "model-broker-call",
        "provider_family": "openai",
        "model_allowlist": ("gpt-5",),
        "operation_allowlist": ("model.complete",),
        "ttl_seconds": 300,
        "budget_requests_remaining": 2,
        "sequence_policy": "single-use-sequence",
        "audit_event_id": "audit_abc",
    }
    values.update(overrides)
    return CredentialGrant(**values)


def request(**overrides):
    values = {
        "grant_id": "grant_ref_abc",
        "profile_id": "dev-director",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "provider_family": "openai",
        "model": "gpt-5",
        "operation": "model.complete",
        "sequence_id": "seq-1",
        "idempotency_key": "idem-1",
        "payload_ref_or_hash": "payload_hash_abc",
        "audit_context": {"surface": "terminal"},
    }
    values.update(overrides)
    return ModelBrokerRequest(**values)


class PanksterRuntimeSecurityModelBrokerContractTests(unittest.TestCase):
    def test_prepare_model_provider_call_validates_before_boundary_without_calling_provider(self):
        response = prepare_model_provider_call(request=request(), grant=grant(), audit_sink=AuditSinkState(True))

        self.assertTrue(response.allowed)
        self.assertEqual(response.reason, "PROVIDER_BOUNDARY_READY_NO_CALL_PERFORMED")
        self.assertIsNone(response.sanitized_output_ref_or_payload)
        self.assertEqual(response.usage["requests_reserved"], 1)
        self.assertEqual(response.updated_grant.budget_requests_remaining, 1)

    def test_model_broker_fails_closed_when_broker_or_audit_unavailable(self):
        broker_denied = prepare_model_provider_call(request=request(), grant=grant(), audit_sink=AuditSinkState(True), credential_broker_available=False)
        audit_denied = prepare_model_provider_call(request=request(), grant=grant(), audit_sink=AuditSinkState(False))

        self.assertEqual(broker_denied.reason, "CREDENTIAL_BROKER_UNAVAILABLE")
        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")

    def test_model_broker_enforces_model_operation_budget_and_replay(self):
        self.assertEqual(prepare_model_provider_call(request=request(model="gpt-4.1"), grant=grant(), audit_sink=AuditSinkState(True)).reason, "MODEL_NOT_ALLOWLISTED")
        self.assertEqual(prepare_model_provider_call(request=request(operation="files.read"), grant=grant(), audit_sink=AuditSinkState(True)).reason, "OPERATION_NOT_ALLOWLISTED")
        self.assertEqual(prepare_model_provider_call(request=request(), grant=grant(budget_requests_remaining=0), audit_sink=AuditSinkState(True)).reason, "BUDGET_EXCEEDED")
        self.assertEqual(prepare_model_provider_call(request=request(), grant=grant(), audit_sink=AuditSinkState(True), used_sequences=("seq-1",)).reason, "REPLAY_DETECTED")

    def test_model_broker_rejects_attempt_and_runtime_mismatch_before_boundary(self):
        self.assertEqual(prepare_model_provider_call(request=request(attempt_id="attempt-2"), grant=grant(), audit_sink=AuditSinkState(True)).reason, "ATTEMPT_MISMATCH")
        self.assertEqual(
            prepare_model_provider_call(request=request(runtime_identity_hash="other-runtime"), grant=grant(), audit_sink=AuditSinkState(True)).reason,
            "RUNTIME_IDENTITY_MISMATCH",
        )

    def test_model_broker_rejects_secret_shaped_payload_and_sanitizes_errors(self):
        response = prepare_model_provider_call(
            request=request(payload_ref_or_hash="Bearer abcdefghijklmnopqrstuvwxyz123456"),
            grant=grant(),
            audit_sink=AuditSinkState(True),
        )

        self.assertEqual(response.reason, "MODEL_REQUEST_SECRET_SCAN_FAILED")
        self.assertEqual(sanitize_provider_error(RuntimeError("fixture")), "RuntimeError")


if __name__ == "__main__":
    unittest.main()
