import unittest

from tools.pankster_runtime_security.fake_grants import FakeGrantRegistry
from tools.pankster_runtime_security.fake_model_broker import FakeModelBroker, FakeModelRequest


def broker_and_grant():
    registry = FakeGrantRegistry()
    grant = registry.issue_grant(
        profile_id="synthetic-profile",
        workflow_id="workflow-1",
        task_id="task-1",
        attempt_id="attempt-1",
        purpose="model",
        provider_family="fake-provider",
        model_allowlist=("fake-model",),
        operation_allowlist=("model.complete",),
        ttl_seconds=60,
        budget_requests=1,
        policy_version="policy-v1",
        runtime_identity_hash="runtime-hash",
        network_policy_id="deny-all",
    ).grant
    return FakeModelBroker(registry), grant


def request_for(grant, **overrides):
    values = {
        "grant_id": grant.grant_id,
        "profile_id": "synthetic-profile",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "provider_family": "fake-provider",
        "model": "fake-model",
        "operation": "model.complete",
        "sequence_id": "seq-1",
        "input_payload_hash": "abc123def4567890",
    }
    values.update(overrides)
    return FakeModelRequest(**values)


class PanksterRuntimeSecurityFakeModelBrokerTests(unittest.TestCase):
    def test_fake_broker_returns_secret_free_synthetic_response(self):
        broker, grant = broker_and_grant()

        response = broker.complete(request_for(grant))

        self.assertTrue(response.allowed)
        self.assertEqual(response.reason, "FAKE_MODEL_COMPLETED")
        self.assertEqual(response.usage, {"requests": 1})
        self.assertTrue(response.audit_event_id.startswith("audit_fake_"))
        self.assertIsNotNone(response.grant_usage_hash)
        self.assertNotIn("secret", response.result_payload.lower())
        self.assertNotIn("token", response.result_payload.lower())

    def test_fake_broker_denies_model_not_allowlisted_before_response(self):
        broker, grant = broker_and_grant()

        response = broker.complete(request_for(grant, model="denied-model"))

        self.assertFalse(response.allowed)
        self.assertEqual(response.reason, "MODEL_NOT_ALLOWLISTED")
        self.assertIsNone(response.result_payload)
        self.assertEqual(response.usage, {"requests": 0})

    def test_fake_broker_denies_replay(self):
        broker, grant = broker_and_grant()

        first = broker.complete(request_for(grant, sequence_id="seq-replay"))
        replay = broker.complete(request_for(grant, sequence_id="seq-replay"))

        self.assertTrue(first.allowed)
        self.assertFalse(replay.allowed)
        self.assertEqual(replay.reason, "GRANT_REPLAY_DETECTED")

    def test_fake_broker_denies_attempt_mismatch(self):
        broker, grant = broker_and_grant()

        response = broker.complete(request_for(grant, attempt_id="other-attempt"))

        self.assertFalse(response.allowed)
        self.assertEqual(response.reason, "GRANT_ATTEMPT_MISMATCH")

    def test_fake_broker_budget_exceeded_denies_second_distinct_request(self):
        broker, grant = broker_and_grant()

        first = broker.complete(request_for(grant, sequence_id="seq-1"))
        second = broker.complete(request_for(grant, sequence_id="seq-2"))

        self.assertTrue(first.allowed)
        self.assertFalse(second.allowed)
        self.assertEqual(second.reason, "BUDGET_EXCEEDED")


if __name__ == "__main__":
    unittest.main()
