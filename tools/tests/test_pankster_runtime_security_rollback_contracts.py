import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.rollback_contracts import RuntimeRollbackState, deny_new_grants, revoke_attempt_grants, rollback_named_profile_runtime


def state(**overrides):
    values = {
        "profile_id": "dev-director",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "policy_version": "policy-v1",
        "runtime_started": True,
        "new_grants_allowed": True,
        "active_grant_refs": ("grant_ref_1", "grant_ref_2"),
    }
    values.update(overrides)
    return RuntimeRollbackState(**values)


class PanksterRuntimeSecurityRollbackContractTests(unittest.TestCase):
    def test_deny_new_grants_does_not_touch_gateway(self):
        result = deny_new_grants(state())

        self.assertFalse(result.new_grants_allowed)
        self.assertFalse(result.gateway_changed)

    def test_revoke_attempt_grants_moves_active_to_revoked(self):
        result = revoke_attempt_grants(state(revoked_grant_refs=("grant_ref_old",)))

        self.assertEqual(result.active_grant_refs, ())
        self.assertEqual(result.revoked_grant_refs, ("grant_ref_1", "grant_ref_2", "grant_ref_old"))

    def test_rollback_completes_secret_free_without_gateway_change(self):
        result = rollback_named_profile_runtime(state(), AuditSinkState(True))

        self.assertTrue(result.allowed)
        self.assertEqual(result.reason, "ROLLBACK_COMPLETED")
        self.assertFalse(result.state.runtime_started)
        self.assertFalse(result.state.new_grants_allowed)
        self.assertFalse(result.state.gateway_changed)
        self.assertTrue(result.audit_event_id.startswith("audit_"))

    def test_rollback_fails_closed_when_audit_unavailable_but_denies_new_grants(self):
        result = rollback_named_profile_runtime(state(), AuditSinkState(False))

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "ROLLBACK_AUDIT_UNAVAILABLE")
        self.assertFalse(result.state.new_grants_allowed)

    def test_rollback_rejects_invalid_context(self):
        result = rollback_named_profile_runtime(state(profile_id=""), AuditSinkState(True))

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "ROLLBACK_CONTEXT_FIELD_MISSING:profile_id")


if __name__ == "__main__":
    unittest.main()
