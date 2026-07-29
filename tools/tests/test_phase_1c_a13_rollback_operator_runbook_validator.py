import json
import unittest

from tools.phase_1c_a13_rollback_operator_runbook_validator import DEFAULT_RUNBOOK, validate_runbook


class Phase1CA13RollbackOperatorRunbookValidatorTests(unittest.TestCase):
    def test_a13_runbook_validates_without_deployment_or_implementation_approval(self):
        result = validate_runbook()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "OPERATOR_RUNBOOK_READY_FOR_FINAL_IMPLEMENTATION_READINESS_REVIEW_NOT_DEPLOYMENT")
        self.assertEqual(result["status"], "ROLLBACK_AND_OPERATOR_RUNBOOK_COMPLETE_NO_DEPLOYMENT_APPROVAL")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertEqual(result["next_gate"], "A14_FINAL_IMPLEMENTATION_READINESS_REVIEW")

    def test_feature_flags_default_disabled(self):
        runbook = json.loads(DEFAULT_RUNBOOK.read_text(encoding="utf-8"))
        flags = runbook["decision_content"]["feature_flags"]

        for value in flags.values():
            self.assertFalse(value)
        self.assertIn("runtime_adapter_enabled_default", flags)
        self.assertIn("production_profiles_enabled_default", flags)

    def test_operator_policy_forbids_secret_runtime_and_gateway_actions(self):
        runbook = json.loads(DEFAULT_RUNBOOK.read_text(encoding="utf-8"))
        policy = runbook["decision_content"]["operator_commands_policy"]

        self.assertFalse(policy["commands_in_a13_executable"])
        self.assertTrue(policy["commands_must_not_print_secrets"])
        self.assertTrue(policy["commands_must_not_read_auth_json"])
        self.assertTrue(policy["commands_must_not_read_keychain"])
        self.assertTrue(policy["commands_must_not_restart_gateway"])
        self.assertTrue(policy["commands_must_not_start_profiles"])
        self.assertTrue(policy["commands_must_not_call_providers"])

    def test_rollback_sequence_preserves_default_gateway_and_disables_runtime(self):
        runbook = json.loads(DEFAULT_RUNBOOK.read_text(encoding="utf-8"))
        sequence = runbook["decision_content"]["rollback_sequence"]
        verification = runbook["decision_content"]["rollback_verification_checks"]

        self.assertIn("disable_named_profile_runtime_feature_flag", sequence)
        self.assertIn("disable_runtime_adapter_feature_flag", sequence)
        self.assertIn("disable_host_model_broker_feature_flag", sequence)
        self.assertIn("disable_credential_broker_feature_flag", sequence)
        self.assertIn("verify_default_gateway_still_serving", sequence)
        self.assertIn("default_profile_smoke_check_unchanged", verification)

    def test_emergency_stops_and_tests_cover_credentials_oauth_gateway_and_destroy(self):
        runbook = json.loads(DEFAULT_RUNBOOK.read_text(encoding="utf-8"))
        content = runbook["decision_content"]

        for stop in ("provider_secret_detected_in_env_argv_logs_or_evidence", "root_auth_json_read_detected", "oauth_refresh_by_worker_or_adapter_detected", "gateway_restart_attempt_detected", "sandbox_destroy_failure"):
            self.assertIn(stop, content["emergency_stop_conditions"])
        self.assertIn("operator_runbook_contains_no_secret_values", content["required_tests"]["security"])
        self.assertIn("manual_approval_required_before_execution_steps", content["required_tests"]["security"])


if __name__ == "__main__":
    unittest.main()
