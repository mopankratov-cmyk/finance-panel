import json
import unittest

from tools.phase_1e_a29_profile_worker_binding_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, validate_evidence


class Phase1EA29ProfileWorkerBindingApprovalRequestValidatorTests(unittest.TestCase):
    def test_1e_a29_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1e_a29_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_integration"])

    def test_1e_a29_scope_allows_only_disabled_profile_worker_binding_contracts_and_tests(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        for field in ("disabled_by_default_profile_worker_binding_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"):
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in {"disabled_by_default_profile_worker_binding_contract_allowed", "tools_runtime_security_files_allowed", "unit_tests_allowed", "local_static_validation_allowed", "local_unittest_allowed"}:
                self.assertFalse(value)

    def test_1e_a29_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(
            allowlist,
            [
                "tools/pankster_runtime_security/profile_worker_binding_contracts.py",
                "tools/tests/test_pankster_runtime_security_profile_worker_binding_contracts.py",
            ],
        )

    def test_1e_a29_records_targeted_test_pass_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]["targeted_approval_request_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A30_PROFILE_WORKER_BINDING_CONTRACT_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
