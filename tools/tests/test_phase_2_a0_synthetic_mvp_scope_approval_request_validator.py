import json
import unittest

from tools.phase_2_a0_synthetic_mvp_scope_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, EXPECTED_FUTURE_FILE_SCOPE, validate_evidence


class Phase2A0SyntheticMvpScopeApprovalRequestValidatorTests(unittest.TestCase):
    def test_phase_2_a0_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["synthetic_only"])
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["real_credentials_approved"])
        self.assertFalse(result["network_calls_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_phase_2_a0_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_implementation"])

    def test_phase_2_a0_scope_is_synthetic_only(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        for field in (
            "synthetic_only_mvp_allowed",
            "fake_credentials_only_required",
            "fake_model_broker_only_required",
            "terminal_surface_fake_or_fail_closed_required",
            "code_execution_surface_fake_or_fail_closed_required",
            "delegate_task_surface_fake_or_fail_closed_required",
            "mcp_surface_fake_or_fail_closed_required",
        ):
            self.assertTrue(scope[field])
        for field in ("real_credentials_allowed", "network_calls_allowed", "runtime_process_launch_allowed", "subprocess_launch_allowed", "sandbox_creation_allowed", "production_profiles_allowed"):
            self.assertFalse(scope[field])

    def test_phase_2_a0_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_file_scope_allowlist"]

        self.assertEqual(allowlist, EXPECTED_FUTURE_FILE_SCOPE)

    def test_phase_2_a0_records_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(content["source_evidence"]["phase_1f_a26_content_sha256"], "163fc0b33591319bec8a980ced0dc9a6a1a79a6de524bd8ae5a10b71d6fdc799")
        self.assertEqual(tests["phase_1f_a26_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 909)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_2_A1_SYNTHETIC_ONLY_MVP_IMPLEMENTATION_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
