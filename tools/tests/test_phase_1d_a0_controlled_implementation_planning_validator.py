import json
import unittest

from tools.phase_1d_a0_controlled_implementation_planning_validator import DEFAULT_PLAN, validate_plan


class Phase1DA0ControlledImplementationPlanningValidatorTests(unittest.TestCase):
    def test_a0_plan_validates_without_code_or_runtime_approval(self):
        result = validate_plan()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "PHASE_1D_SCOPE_READY_FOR_FEATURE_FLAGGED_IMPLEMENTATION_PLANNING_ONLY")
        self.assertFalse(result["implementation_code_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT")

    def test_gate_sequence_declares_code_permissions(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        gates = {entry["gate"]: entry["allows_code"] for entry in plan["decision_content"]["phase_1d_gate_sequence"]}

        self.assertFalse(gates["1D-A1_IMPLEMENTATION_SCOPE_AND_BRANCH_CONTRACT"])
        self.assertFalse(gates["1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC"])
        self.assertTrue(gates["1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION"])
        self.assertTrue(gates["1D-A4_ENVIRONMENT_SANITIZER_IMPLEMENTATION"])
        self.assertTrue(gates["1D-A5_FAKE_GRANT_REGISTRY_AND_BROKER_IMPLEMENTATION"])
        self.assertTrue(gates["1D-A6_RUNTIME_ADAPTER_INTERFACE_STUBS"])
        self.assertFalse(gates["1D-A7_SYNTHETIC_RUNNER_PREFLIGHT_CONTRACT"])

    def test_feature_flags_are_default_disabled(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        flags = plan["decision_content"]["feature_flags_default_disabled"]

        for value in flags.values():
            self.assertFalse(value)
        self.assertIn("PANKSTER_RUNTIME_ADAPTER_ENABLED", flags)
        self.assertIn("PANKSTER_NAMED_PROFILE_RUNTIME_ENABLED", flags)
        self.assertIn("PANKSTER_SYNTHETIC_RUNNER_ENABLED", flags)

    def test_forbidden_scope_blocks_runtime_gateway_credentials_and_production(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        forbidden = plan["decision_content"]["forbidden_planning_scope"]

        for item in ("modify_hermes_core_runtime_behavior", "start_gateway_or_canary", "start_profiles", "call_real_model_or_provider_apis", "read_auth_json_or_keychain", "perform_oauth_refresh", "deploy_to_production"):
            self.assertIn(item, forbidden)

    def test_module_boundaries_forbid_credentials_network_and_sandbox_launch(self):
        plan = json.loads(DEFAULT_PLAN.read_text(encoding="utf-8"))
        modules = plan["decision_content"]["initial_module_boundaries"]

        self.assertIn("credential reads", modules["policy_schema_validator"]["forbidden"])
        self.assertIn("network clients", modules["fake_model_broker"]["forbidden"])
        self.assertIn("real secrets", modules["fake_grant_registry"]["forbidden"])
        self.assertIn("sandbox launch", modules["runtime_adapter_stubs"]["forbidden"])


if __name__ == "__main__":
    unittest.main()
