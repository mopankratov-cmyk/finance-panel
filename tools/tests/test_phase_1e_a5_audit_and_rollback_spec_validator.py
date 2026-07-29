import json
import unittest

from tools.phase_1e_a5_audit_and_rollback_spec_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA5AuditAndRollbackSpecValidatorTests(unittest.TestCase):
    def test_1e_a5_evidence_validates_audit_rollback_spec(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A6_IMPLEMENTATION_SCOPE_LOCK")

    def test_1e_a5_audit_contract_requires_secret_free_fail_closed_audit(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        audit = evidence["decision_content"]["audit_contract"]

        self.assertTrue(audit["audit_required_before_grant_issue"])
        self.assertTrue(audit["audit_required_before_provider_call"])
        self.assertTrue(audit["audit_unavailable_fails_closed"])
        self.assertTrue(audit["audit_events_secret_free"])

    def test_1e_a5_required_events_cover_grant_model_runtime_rollback_refresh(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        events = evidence["decision_content"]["required_audit_events"]

        self.assertIn("grant.issued", events)
        self.assertIn("model.completed", events)
        self.assertIn("runtime.destroyed", events)
        self.assertIn("rollback.completed", events)
        self.assertIn("credential.refresh.denied", events)

    def test_1e_a5_rollback_contract_disables_runtime_without_gateway_change(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        rollback = evidence["decision_content"]["rollback_contract"]

        self.assertTrue(rollback["disable_named_profile_runtime_without_gateway_change"])
        self.assertTrue(rollback["deny_new_grants_immediately"])
        self.assertTrue(rollback["revoke_attempt_grants"])
        self.assertTrue(rollback["write_secret_free_rollback_audit"])

    def test_1e_a5_forbidden_audit_fields_cover_raw_secrets_and_auth(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        forbidden = evidence["decision_content"]["forbidden_audit_fields"]

        self.assertIn("authorization_header", forbidden)
        self.assertIn("provider_secret_value", forbidden)
        self.assertIn("root_auth_json_content", forbidden)
        self.assertIn("credential_pool", forbidden)


if __name__ == "__main__":
    unittest.main()
