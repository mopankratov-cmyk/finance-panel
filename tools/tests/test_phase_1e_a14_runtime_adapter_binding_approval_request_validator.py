import json
import unittest

from tools.phase_1e_a14_runtime_adapter_binding_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, validate_evidence


class Phase1EA14RuntimeAdapterBindingApprovalRequestValidatorTests(unittest.TestCase):
    def test_1e_a14_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["binding_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1e_a14_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_binding"])

    def test_1e_a14_scope_allows_only_disabled_binding_contracts_and_tests(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        for field in ("disabled_by_default_binding_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"):
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in {"disabled_by_default_binding_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"}:
                self.assertFalse(value)

    def test_1e_a14_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(
            allowlist,
            [
                "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
            ],
        )

    def test_1e_a14_records_targeted_test_pass_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]["targeted_approval_request_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A15_RUNTIME_ADAPTER_BINDING_CONTRACT_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
