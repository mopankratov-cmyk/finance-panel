import json
import unittest

from tools.phase_1d_a11_synthetic_preflight_execution_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA11SyntheticPreflightExecutionReviewValidatorTests(unittest.TestCase):
    def test_a11_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "PASS_SYNTHETIC_DRY_RUN_REVIEW_NOT_PRODUCTION_READY")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A12_RUNTIME_INTEGRATION_SCOPE_DECISION")

    def test_a11_accepted_findings_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["accepted_findings"]

        self.assertTrue(findings)
        for value in findings.values():
            self.assertTrue(value)

    def test_a11_keeps_runtime_and_production_unapproved(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertFalse(content["deployment_approved"])
        self.assertFalse(content["production_profiles_approved"])
        self.assertFalse(content["provider_api_calls_approved"])
        self.assertFalse(content["sandbox_execution_approved"])
        self.assertFalse(content["gateway_changes_approved"])

    def test_a11_records_residual_risks_for_real_runtime(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        risks = evidence["decision_content"]["residual_risks"]

        self.assertIn("A10 was an in-process synthetic dry-run only, not a real sandbox isolation run", risks)
        self.assertIn("host-side real credential broker remains unimplemented", risks)
        self.assertIn("production profiles remain disabled/not approved", risks)

    def test_a11_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_a11_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)


if __name__ == "__main__":
    unittest.main()
