import json
import unittest

from tools.phase_1f_a8_versioned_runtime_integration_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, EXPECTED_FUTURE_FILE_SCOPE, validate_evidence


class Phase1FA8VersionedRuntimeIntegrationApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a8_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1f_a8_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_integration"])

    def test_1f_a8_scope_allows_only_versioned_runtime_integration_contract_review(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]
        allowed_true = {
            "versioned_runtime_integration_contract_review_allowed",
            "unit_tests_allowed",
            "local_static_validation_allowed",
            "local_unittest_allowed",
        }

        for field in allowed_true:
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in allowed_true:
                self.assertFalse(value)

    def test_1f_a8_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(allowlist, EXPECTED_FUTURE_FILE_SCOPE)

    def test_1f_a8_records_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(content["source_evidence"]["phase_1f_a7_content_sha256"], "295f237c2672b11e7cc0078c9763ab097959ea63f9277c1defdf2404b2723400")
        self.assertEqual(tests["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 802)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A9_VERSIONED_RUNTIME_INTEGRATION_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
