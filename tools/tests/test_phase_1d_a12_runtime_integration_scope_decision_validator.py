import json
import unittest

from tools.phase_1d_a12_runtime_integration_scope_decision_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA12RuntimeIntegrationScopeDecisionValidatorTests(unittest.TestCase):
    def test_a12_evidence_validates_scope_decision(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A13_PHASE_1D_CLOSEOUT_PACKAGE")

    def test_a12_closes_phase_1d_at_synthetic_baseline(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        decision = evidence["decision_content"]["scope_decision"]

        self.assertEqual(decision["phase_1d_deliverable"], "synthetic_runtime_security_baseline_only")
        self.assertFalse(decision["real_runtime_integration_in_phase_1d"])
        self.assertFalse(decision["production_deployment_in_phase_1d"])
        self.assertTrue(decision["new_phase_required_for_runtime_integration"])

    def test_a12_blocks_real_runtime_paths_until_phase_1e(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        blocked = evidence["decision_content"]["blocked_until_phase_1e"]

        for item in ("sandbox runtime integration", "host-side real credential broker", "real model broker provider calls", "gateway integration", "production deployment"):
            self.assertIn(item, blocked)

    def test_a12_phase_1e_requires_owner_approval_and_security_review(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        requirements = evidence["decision_content"]["phase_1e_entry_requirements"]

        self.assertIn("owner approval for any sandbox/process launch", requirements)
        self.assertIn("owner approval for any dependency or provider SDK use", requirements)
        self.assertIn("independent security review before production", requirements)

    def test_a12_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_a12_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)


if __name__ == "__main__":
    unittest.main()
