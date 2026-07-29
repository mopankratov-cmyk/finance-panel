import json
import unittest

from tools.phase_1e_a8_implementation_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, validate_evidence


class Phase1EA8ImplementationApprovalRequestValidatorTests(unittest.TestCase):
    def test_1e_a8_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1e_a8_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_implementation"])

    def test_1e_a8_scope_allows_only_pure_contract_local_work(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        for field in ("pure_contract_code_allowed", "allowlisted_tools_files_only", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"):
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in {"pure_contract_code_allowed", "allowlisted_tools_files_only", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"}:
                self.assertFalse(value)

    def test_1e_a8_does_not_approve_runtime_provider_or_credentials(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertFalse(content["implementation_performed"])
        self.assertFalse(content["sandbox_execution_approved"])
        self.assertFalse(content["subprocess_launch_approved"])
        self.assertFalse(content["provider_api_calls_approved"])
        self.assertFalse(content["model_api_calls_approved"])
        self.assertFalse(content["oauth_refresh_approved"])

    def test_1e_a8_records_targeted_test_pass_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]["targeted_approval_request_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A9_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
