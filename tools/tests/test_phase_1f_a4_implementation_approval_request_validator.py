import hashlib
import json
import unittest

from tools.phase_1f_a4_implementation_approval_request_validator import (
    DEFAULT_EVIDENCE,
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    validate_evidence,
)


class Phase1FA4ImplementationApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a4_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1f_a4_approval_command_hash_is_exact(self):
        self.assertEqual(hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest(), EXPECTED_APPROVAL_SHA)

    def test_1f_a4_scope_allows_only_pure_contract_implementation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["implementation_code_allowed"])
        self.assertTrue(scope["pure_contract_layer_only_allowed"])
        self.assertTrue(scope["unit_tests_allowed"])
        self.assertFalse(scope["profile_runtime_execution_allowed"])
        self.assertFalse(scope["profile_start_allowed"])
        self.assertFalse(scope["provider_api_calls_allowed"])
        self.assertFalse(scope["real_credentials_allowed"])

    def test_1f_a4_future_file_scope_is_a2_allowlist_only(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["decision_content"]["future_file_scope_allowlist"],
            [
                "tools/pankster_runtime_security/runtime_integration_contracts.py",
                "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
            ],
        )

    def test_1f_a4_records_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(
            content["source_evidence"]["phase_1f_a3_verdict"],
            "READY_FOR_PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_NOT_CODE",
        )
        self.assertEqual(content["test_results"]["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(content["test_results"]["full_tools_unittest_discover"]["tests"], 775)
        self.assertEqual(content["next_gate"], "PHASE_1F_A5_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
