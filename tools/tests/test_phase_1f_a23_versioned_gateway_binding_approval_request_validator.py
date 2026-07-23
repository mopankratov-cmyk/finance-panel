import json
import unittest

from tools.phase_1f_a23_versioned_gateway_binding_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, EXPECTED_FUTURE_FILE_SCOPE, validate_evidence


class Phase1FA23VersionedGatewayBindingApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a23_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["gateway_binding_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_1f_a23_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_implementation"])

    def test_1f_a23_scope_allows_only_versioned_gateway_binding_pure_contract_implementation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]
        allowed_true = {
            "disabled_by_default_versioned_gateway_binding_contract_allowed",
            "implementation_code_allowed",
            "local_static_validation_allowed",
            "local_unittest_allowed",
            "pure_contract_layer_only_allowed",
            "unit_tests_allowed",
            "versioned_gateway_binding_module_allowed",
        }

        for field in allowed_true:
            self.assertTrue(scope[field])
        for field, value in scope.items():
            if field not in allowed_true:
                self.assertFalse(value)

    def test_1f_a23_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(allowlist, EXPECTED_FUTURE_FILE_SCOPE)

    def test_1f_a23_records_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(content["source_evidence"]["phase_1f_a22_content_sha256"], "7eefbec3c0264a8bd1a366535b6127e3b369485811ef82e8df165a9d05774aa4")
        self.assertEqual(tests["phase_1f_a22_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 886)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A24_VERSIONED_GATEWAY_BINDING_CONTRACT_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
