import json
import unittest

from tools.phase_1c_a12_synthetic_integration_test_plan_validator import DEFAULT_PLAN, validate_plan


class Phase1CA12SyntheticIntegrationTestPlanValidatorTests(unittest.TestCase):
    def test_a12_plan_validates_without_execution_or_runtime_approval(self):
        result = validate_plan()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "SYNTHETIC_ONLY_INTEGRATION_TEST_PLAN_READY_NOT_RUNTIME_EXECUTION")
        self.assertEqual(result["status"], "SYNTHETIC_INTEGRATION_TEST_PLAN_COMPLETE_NO_EXECUTION_APPROVAL")
        self.assertFalse(result["test_execution_approved"])
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertEqual(result["next_gate"], "A13_ROLLBACK_AND_OPERATOR_RUNBOOK")

    def test_fixture_inventory_is_synthetic_and_secret_free(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        inventory = plan["decision_content"]["fixture_inventory"]

        self.assertFalse(inventory["secret_values_present"])
        self.assertIn("synthetic-enabled-test-profile", inventory["synthetic_profiles"])
        self.assertIn("fake-provider-reference-not-secret", inventory["synthetic_credentials"])
        self.assertIn("root-auth-trap-path", inventory["synthetic_artifacts"])
        self.assertIn("deny_all", inventory["network_modes"])

    def test_required_suites_cover_policy_adapter_broker_children_lifecycle_and_secrets(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        suites = plan["decision_content"]["test_suites"]

        for suite in ("policy_contract_suite", "runtime_adapter_suite", "broker_suite", "child_process_suite", "lifecycle_suite", "secret_regression_suite"):
            self.assertIn(suite, suites)
        self.assertIn("terminal_child_receives_sanitized_env", suites["child_process_suite"])
        self.assertIn("retry_uses_new_attempt_and_new_grants", suites["lifecycle_suite"])
        self.assertIn("root_credential_pool_trap_path_not_materialized", suites["secret_regression_suite"])

    def test_required_assertions_forbid_provider_gateway_profiles_and_raw_env(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        assertions = plan["decision_content"]["required_assertions"]

        self.assertTrue(assertions["all_tests_use_synthetic_fixtures"])
        self.assertFalse(assertions["real_provider_credentials_required"])
        self.assertFalse(assertions["provider_api_calls_allowed"])
        self.assertFalse(assertions["production_profile_launch_allowed"])
        self.assertFalse(assertions["gateway_change_allowed"])
        self.assertFalse(assertions["raw_env_capture_allowed"])

    def test_execution_gate_and_security_tests_block_auth_keychain_and_network(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        content = plan["decision_content"]

        self.assertIn("runner_does_not_read_auth_json_or_keychain", content["execution_gate_requirements"])
        self.assertIn("test_attempts_provider_network_call", content["fail_closed_cases"])
        self.assertIn("test_attempts_keychain_read", content["fail_closed_cases"])
        self.assertIn("no_network_provider_call_probe", content["required_tests"]["security"])
        self.assertIn("no_auth_json_or_keychain_access_probe", content["required_tests"]["security"])


if __name__ == "__main__":
    unittest.main()
