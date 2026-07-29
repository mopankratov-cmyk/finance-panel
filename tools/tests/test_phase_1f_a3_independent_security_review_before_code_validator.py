import json
import unittest

from tools.phase_1f_a3_independent_security_review_before_code_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1FA3IndependentSecurityReviewBeforeCodeValidatorTests(unittest.TestCase):
    def test_1f_a3_evidence_validates_review_verdict_without_implementation_approval(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["runtime_execution_approved"])

    def test_1f_a3_validated_chain_covers_a0_through_a2(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        chain = evidence["decision_content"]["validated_gate_chain"]

        self.assertEqual([item["gate"] for item in chain], ["1F-A0", "1F-A1", "1F-A2"])
        self.assertTrue(all(item["result"] == "PASS" for item in chain))

    def test_1f_a3_findings_keep_runtime_credentials_gateway_and_providers_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["a2_future_code_allowlist_is_narrow"])
        self.assertTrue(findings["a2_requires_separate_a4_approval_before_implementation"])
        self.assertTrue(findings["no_gateway_web_server_profile_worker_or_hermes_core_changes"])
        self.assertTrue(findings["no_provider_or_model_api_calls_performed"])
        self.assertTrue(findings["no_runtime_process_subprocess_or_sandbox_launch_added"])
        self.assertTrue(findings["root_auth_fallback_not_approved"])
        self.assertTrue(findings["oauth_refresh_materialization_not_approved"])
        self.assertTrue(findings["fail_closed_behavior_required"])

    def test_1f_a3_pre_code_controls_require_allowlist_and_no_runtime_surface(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        controls = evidence["decision_content"]["pre_code_required_controls"]

        self.assertIn("implementation may not begin until a separate exact Phase 1F-A4 owner approval is issued", controls)
        self.assertIn("implement only files in the 1F-A2 future code allowlist unless a new approval expands scope", controls)
        self.assertIn("do not add network clients, provider SDKs, subprocess launch, sandbox launch, or runtime process launch", controls)
        self.assertIn(
            "do not change gateway.py, web_server.py, profile worker runtime paths, Hermes core, app/lib runtime code, dependencies, or lockfiles",
            controls,
        )

    def test_1f_a3_records_full_suite_required_changes_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1f_validator_chain"]["result"], "PASS")
        self.assertEqual(tests["phase_1f_validator_chain"]["validators"], 3)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 770)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
