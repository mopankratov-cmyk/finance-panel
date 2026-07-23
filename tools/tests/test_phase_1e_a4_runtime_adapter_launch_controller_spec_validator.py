import json
import unittest

from tools.phase_1e_a4_runtime_adapter_launch_controller_spec_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA4RuntimeAdapterLaunchControllerSpecValidatorTests(unittest.TestCase):
    def test_1e_a4_evidence_validates_launch_controller_spec(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A5_AUDIT_AND_ROLLBACK_SPEC")

    def test_1e_a4_launch_requires_approval_policy_audit_and_sanitized_env(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["launch_controller_contract"]

        self.assertTrue(contract["launch_requires_explicit_owner_approval"])
        self.assertTrue(contract["launch_requires_valid_profile_policy"])
        self.assertTrue(contract["launch_requires_audit_sink_available"])
        self.assertTrue(contract["launch_requires_sanitized_environment"])

    def test_1e_a4_environment_contract_preserves_proxy_and_sanitizes_children(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["environment_contract"]

        self.assertTrue(contract["preserve_no_proxy"])
        self.assertTrue(contract["mandatory_sensitive_denylist"])
        self.assertTrue(contract["terminal_mcp_delegation_code_execution_background_sanitized"])
        self.assertTrue(contract["denylist_precedence"])

    def test_1e_a4_lifecycle_states_include_destroy_and_rollback(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        states = evidence["decision_content"]["lifecycle_states"]

        self.assertIn("preflight_validated", states)
        self.assertIn("environment_sanitized", states)
        self.assertIn("destroyed", states)
        self.assertIn("rollback_disabled", states)

    def test_1e_a4_fail_closed_cases_cover_approval_audit_secret_and_reclaim(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        cases = evidence["decision_content"]["fail_closed_cases"]

        self.assertIn("missing_owner_approval", cases)
        self.assertIn("audit_unavailable", cases)
        self.assertIn("provider_secret_detected", cases)
        self.assertIn("retry_or_reclaim_context_mismatch", cases)


if __name__ == "__main__":
    unittest.main()
