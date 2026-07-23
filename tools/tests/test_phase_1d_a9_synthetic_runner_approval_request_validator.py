import json
import unittest

from tools.phase_1d_a9_synthetic_runner_approval_request_validator import DEFAULT_EVIDENCE, EXPECTED_APPROVAL, EXPECTED_APPROVAL_SHA, validate_evidence


class Phase1DA9SyntheticRunnerApprovalRequestValidatorTests(unittest.TestCase):
    def test_a9_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["execution_performed"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)

    def test_a9_records_exact_approval_command(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approval = evidence["decision_content"]["owner_approval"]

        self.assertEqual(approval["approval_command"], EXPECTED_APPROVAL)
        self.assertEqual(approval["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertTrue(approval["approval_required_before_next_gate_execution"])

    def test_a9_scope_allows_only_synthetic_local_dry_run(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["synthetic_only"])
        self.assertTrue(scope["local_dry_run_only"])
        for field, value in scope.items():
            if field not in {"synthetic_only", "local_dry_run_only"}:
                self.assertFalse(value)

    def test_a9_does_not_approve_execution_or_provider_paths(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertFalse(content["execution_performed"])
        self.assertFalse(content["sandbox_execution_approved"])
        self.assertFalse(content["provider_api_calls_approved"])
        self.assertFalse(content["gateway_changes_approved"])

    def test_a9_records_targeted_test_pass_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]["targeted_approval_request_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)
        self.assertEqual(content["next_gate"], "1D-A10_SYNTHETIC_RUNNER_PREFLIGHT_EXECUTION_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
