import unittest

from tools.pankster_runtime_security.audit_contracts import AuditContext, AuditEvent, AuditSinkState, validate_audit_event


def context(**overrides):
    values = {
        "profile_id": "dev-director",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "policy_version": "policy-v1",
    }
    values.update(overrides)
    return AuditContext(**values)


class PanksterRuntimeSecurityAuditContractTests(unittest.TestCase):
    def test_audit_event_accepts_secret_free_required_event(self):
        result = validate_audit_event(
            AuditEvent("grant.issued", context(), "grant issued", {"credential_ref_id": "cred_ref_primary"}),
            AuditSinkState(available=True),
        )

        self.assertTrue(result.allowed)
        self.assertEqual(result.reason, "AUDIT_ACCEPTED")
        self.assertTrue(result.audit_event_id.startswith("audit_"))

    def test_audit_unavailable_fails_closed(self):
        result = validate_audit_event(
            AuditEvent("model.requested", context(), "model requested", {"model": "gpt-5"}),
            AuditSinkState(available=False),
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "AUDIT_UNAVAILABLE")

    def test_audit_rejects_forbidden_secret_fields_without_leaking_values(self):
        result = validate_audit_event(
            AuditEvent("model.failed", context(), "failed", {"authorization_header": "redacted-fixture"}),
            AuditSinkState(available=True),
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "AUDIT_SECRET_SCAN_FAILED")
        self.assertNotIn("redacted-fixture", str(result))

    def test_audit_invalid_event_type_fails_closed(self):
        result = validate_audit_event(
            AuditEvent("provider.raw", context(), "not allowed", {}),
            AuditSinkState(available=True),
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "AUDIT_EVENT_TYPE_INVALID")

    def test_audit_write_failure_blocks_progress(self):
        result = validate_audit_event(
            AuditEvent("rollback.completed", context(), "rollback completed", {}),
            AuditSinkState(available=True, write_succeeds=False),
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "AUDIT_WRITE_FAILED")


if __name__ == "__main__":
    unittest.main()
