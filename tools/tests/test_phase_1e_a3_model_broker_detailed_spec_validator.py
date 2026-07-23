import json
import unittest

from tools.phase_1e_a3_model_broker_detailed_spec_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA3ModelBrokerDetailedSpecValidatorTests(unittest.TestCase):
    def test_1e_a3_evidence_validates_model_broker_spec(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A4_RUNTIME_ADAPTER_LAUNCH_CONTROLLER_SPEC")

    def test_1e_a3_contract_requires_policy_grant_audit_before_provider_call(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["model_broker_contract"]

        self.assertTrue(contract["host_side_only"])
        self.assertTrue(contract["provider_call_requires_valid_policy_grant_and_audit"])
        self.assertTrue(contract["credential_broker_grant_required"])
        self.assertTrue(contract["audit_unavailable_fails_closed"])

    def test_1e_a3_request_schema_requires_attempt_runtime_idempotency_and_audit(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        fields = evidence["decision_content"]["request_schema_required_fields"]

        self.assertIn("attempt_id", fields)
        self.assertIn("runtime_identity_hash", fields)
        self.assertIn("idempotency_key", fields)
        self.assertIn("audit_context", fields)

    def test_1e_a3_forbidden_response_fields_block_raw_headers_and_secrets(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        forbidden = evidence["decision_content"]["forbidden_response_fields"]

        self.assertIn("authorization_header", forbidden)
        self.assertIn("raw_request_headers", forbidden)
        self.assertIn("raw_response_headers", forbidden)
        self.assertIn("provider_secret_value", forbidden)

    def test_1e_a3_fail_closed_cases_cover_replay_budget_and_broker_failures(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        cases = evidence["decision_content"]["fail_closed_cases"]

        self.assertIn("replay_detected", cases)
        self.assertIn("budget_exceeded", cases)
        self.assertIn("audit_unavailable", cases)
        self.assertIn("credential_broker_unavailable", cases)


if __name__ == "__main__":
    unittest.main()
