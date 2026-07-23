import json
import unittest

from tools.phase_1e_a7_independent_security_review_before_code_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA7IndependentSecurityReviewBeforeCodeValidatorTests(unittest.TestCase):
    def test_1e_a7_evidence_validates_review_verdict_without_implementation_approval(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])

    def test_1e_a7_validated_chain_covers_a0_through_a6(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        chain = evidence["decision_content"]["validated_gate_chain"]

        self.assertEqual([item["gate"] for item in chain], ["1E-A0", "1E-A1", "1E-A2", "1E-A3", "1E-A4", "1E-A5", "1E-A6"])
        self.assertTrue(all(item["result"] == "PASS" for item in chain))

    def test_1e_a7_findings_keep_runtime_credentials_gateway_and_providers_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_gateway_or_hermes_core_changes"])
        self.assertTrue(findings["no_provider_or_model_api_calls_performed"])
        self.assertTrue(findings["no_sandbox_profile_or_canary_started"])
        self.assertTrue(findings["root_auth_fallback_not_approved"])
        self.assertTrue(findings["oauth_refresh_materialization_not_approved"])
        self.assertTrue(findings["fail_closed_behavior_required"])

    def test_1e_a7_pre_code_controls_require_allowlist_grants_and_exact_approval(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        controls = evidence["decision_content"]["pre_code_required_controls"]

        self.assertIn("implement only files in the 1E-A6 future code allowlist unless a new approval expands scope", controls)
        self.assertIn("keep credential broker outputs as opaque references or per-attempt grants, never raw root credential pools", controls)
        self.assertIn(
            "require a separate exact owner approval before provider SDK use, real network call, sandbox launch, subprocess launch, OAuth refresh, or production profile execution",
            controls,
        )

    def test_1e_a7_records_full_suite_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1e_validator_chain"]["result"], "PASS")
        self.assertEqual(tests["phase_1e_validator_chain"]["validators"], 7)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 459)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A8_IMPLEMENTATION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
