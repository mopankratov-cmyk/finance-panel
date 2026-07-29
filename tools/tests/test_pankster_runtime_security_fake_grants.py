import unittest

from tools.pankster_runtime_security.fake_grants import GRANT_ID_PREFIX, FakeGrantRegistry


def issue_default_grant(registry: FakeGrantRegistry, *, budget_requests: int = 1):
    decision = registry.issue_grant(
        profile_id="synthetic-profile",
        workflow_id="workflow-1",
        task_id="task-1",
        attempt_id="attempt-1",
        purpose="model",
        provider_family="fake-provider",
        model_allowlist=("fake-model",),
        operation_allowlist=("model.complete",),
        ttl_seconds=60,
        budget_requests=budget_requests,
        policy_version="policy-v1",
        runtime_identity_hash="runtime-hash",
        network_policy_id="deny-all",
    )
    return decision.grant


class PanksterRuntimeSecurityFakeGrantTests(unittest.TestCase):
    def test_issued_grant_is_opaque_and_non_secret_shaped(self):
        grant = issue_default_grant(FakeGrantRegistry())

        self.assertTrue(grant.grant_id.startswith(GRANT_ID_PREFIX))
        self.assertEqual(len(grant.grant_id), len(GRANT_ID_PREFIX) + 32)
        self.assertNotIn("key", grant.grant_id.lower())
        self.assertNotIn("token", grant.grant_id.lower())

    def test_valid_request_consumes_one_budget_and_blocks_replay(self):
        registry = FakeGrantRegistry()
        grant = issue_default_grant(registry, budget_requests=1)

        first = registry.validate_for_request(
            grant_id=grant.grant_id,
            profile_id="synthetic-profile",
            task_id="task-1",
            attempt_id="attempt-1",
            runtime_identity_hash="runtime-hash",
            provider_family="fake-provider",
            model="fake-model",
            operation="model.complete",
            sequence_id="seq-1",
        )
        replay = registry.validate_for_request(
            grant_id=grant.grant_id,
            profile_id="synthetic-profile",
            task_id="task-1",
            attempt_id="attempt-1",
            runtime_identity_hash="runtime-hash",
            provider_family="fake-provider",
            model="fake-model",
            operation="model.complete",
            sequence_id="seq-1",
        )

        self.assertTrue(first.allowed)
        self.assertEqual(first.grant.budget_requests_remaining, 0)
        self.assertFalse(replay.allowed)
        self.assertEqual(replay.reason, "GRANT_REPLAY_DETECTED")

    def test_attempt_profile_runtime_model_and_operation_mismatches_deny(self):
        registry = FakeGrantRegistry()
        grant = issue_default_grant(registry)

        cases = [
            {"profile_id": "other-profile", "reason": "GRANT_PROFILE_MISMATCH"},
            {"attempt_id": "other-attempt", "reason": "GRANT_ATTEMPT_MISMATCH"},
            {"runtime_identity_hash": "other-runtime", "reason": "RUNTIME_IDENTITY_MISMATCH"},
            {"model": "other-model", "reason": "MODEL_NOT_ALLOWLISTED"},
            {"operation": "other.operation", "reason": "OPERATION_NOT_ALLOWLISTED"},
        ]
        for case in cases:
            kwargs = {
                "grant_id": grant.grant_id,
                "profile_id": case.get("profile_id", "synthetic-profile"),
                "task_id": "task-1",
                "attempt_id": case.get("attempt_id", "attempt-1"),
                "runtime_identity_hash": case.get("runtime_identity_hash", "runtime-hash"),
                "provider_family": "fake-provider",
                "model": case.get("model", "fake-model"),
                "operation": case.get("operation", "model.complete"),
                "sequence_id": f"seq-{case['reason']}",
            }
            decision = registry.validate_for_request(**kwargs)
            self.assertFalse(decision.allowed)
            self.assertEqual(decision.reason, case["reason"])

    def test_expired_and_budget_exceeded_grants_deny(self):
        registry = FakeGrantRegistry()
        expired = issue_default_grant(registry)
        self.assertTrue(registry.expire(expired.grant_id))

        expired_decision = registry.validate_for_request(
            grant_id=expired.grant_id,
            profile_id="synthetic-profile",
            task_id="task-1",
            attempt_id="attempt-1",
            runtime_identity_hash="runtime-hash",
            provider_family="fake-provider",
            model="fake-model",
            operation="model.complete",
            sequence_id="seq-expired",
        )
        budgetless = issue_default_grant(registry, budget_requests=0)
        budget_decision = registry.validate_for_request(
            grant_id=budgetless.grant_id,
            profile_id="synthetic-profile",
            task_id="task-1",
            attempt_id="attempt-1",
            runtime_identity_hash="runtime-hash",
            provider_family="fake-provider",
            model="fake-model",
            operation="model.complete",
            sequence_id="seq-budget",
        )

        self.assertEqual(expired_decision.reason, "GRANT_EXPIRED")
        self.assertEqual(budget_decision.reason, "BUDGET_EXCEEDED")

    def test_invalid_issue_inputs_deny(self):
        registry = FakeGrantRegistry()

        self.assertFalse(
            registry.issue_grant(
                profile_id="p",
                workflow_id="w",
                task_id="t",
                attempt_id="a",
                purpose="model",
                provider_family="fake",
                model_allowlist=(),
                operation_allowlist=("model.complete",),
                ttl_seconds=60,
                budget_requests=1,
                policy_version="p1",
                runtime_identity_hash="r",
                network_policy_id="deny",
            ).allowed
        )


if __name__ == "__main__":
    unittest.main()
