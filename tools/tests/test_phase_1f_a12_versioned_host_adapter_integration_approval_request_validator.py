import json
import unittest

from tools.phase_1f_a12_versioned_host_adapter_integration_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, EXPECTED_FUTURE_FILE_SCOPE, validate_evidence


class Phase1FA12VersionedHostAdapterIntegrationApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a12_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1f_a12_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_integration_review"])

    def test_1f_a12_scope_allows_only_versioned_host_adapter_integration_contract_review(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]
        allowed_true = {
            "host_adapter_integration_contract_review_allowed",
            "unit_tests_allowed",
            "local_static_validation_allowed",
            "local_unittest_allowed",
        }

        for field in allowed_true:
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in allowed_true:
                self.assertFalse(value)

    def test_1f_a12_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(allowlist, EXPECTED_FUTURE_FILE_SCOPE)

    def test_1f_a12_records_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(content["source_evidence"]["phase_1f_a11_content_sha256"], "1a20cd9ea4d7b08346318dfd4365f6524d74b68de467949da3975cfb1f16f4dc")
        self.assertEqual(tests["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 822)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A13_VERSIONED_HOST_ADAPTER_INTEGRATION_CONTRACT_REVIEW_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
