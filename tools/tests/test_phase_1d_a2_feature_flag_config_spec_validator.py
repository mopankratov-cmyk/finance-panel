import json
import unittest

from tools.phase_1d_a2_feature_flag_config_spec_validator import DEFAULT_SPEC, validate_spec


class Phase1DA2FeatureFlagConfigSpecValidatorTests(unittest.TestCase):
    def test_a2_spec_validates_without_code_or_runtime_approval(self):
        result = validate_spec()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "FEATURE_FLAGS_AND_CONFIG_RULES_READY_FOR_PURE_UNIT_IMPLEMENTATION_NOT_RUNTIME")
        self.assertFalse(result["implementation_code_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A3_POLICY_SCHEMA_VALIDATOR_IMPLEMENTATION")

    def test_all_flags_default_false_and_invalid_values_deny(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        flags = spec["decision_content"]["flag_definitions"]

        self.assertEqual(len(flags), 5)
        for definition in flags.values():
            self.assertFalse(definition["default"])
            self.assertIn("true", definition["allowed_true_values"])
            self.assertIn("false", definition["allowed_false_values"])
            self.assertEqual(definition["invalid_value_behavior"], "deny")

    def test_config_source_is_explicit_mapping_only(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        config = spec["decision_content"]["config_source_contract"]

        self.assertEqual(config["input_type"], "explicit_mapping_only")
        self.assertFalse(config["read_process_environment_allowed_in_pure_units"])
        self.assertFalse(config["read_env_files_allowed"])
        self.assertFalse(config["read_auth_json_allowed"])
        self.assertFalse(config["read_keychain_allowed"])
        self.assertFalse(config["network_allowed"])

    def test_gate_dependencies_prevent_partial_runtime_enablement(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        rules = spec["decision_content"]["gate_dependency_rules"]

        self.assertIn("PANKSTER_HOST_MODEL_BROKER_ENABLED", rules["runtime_adapter_requires"])
        self.assertIn("PANKSTER_CREDENTIAL_BROKER_ENABLED", rules["runtime_adapter_requires"])
        self.assertIn("PANKSTER_RUNTIME_ADAPTER_ENABLED", rules["named_profile_runtime_requires"])
        self.assertEqual(rules["production_profile_requires_future_gate"], "not_defined_in_a2")

    def test_forbidden_files_and_fail_closed_cases_block_runtime_scope(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        content = spec["decision_content"]

        for item in ("app/", "components/", "lib/", "package.json", ".env", "gateway.py", "web_server.py", "agent/conversation_loop.py"):
            self.assertIn(item, content["forbidden_files"])
        for case in ("invalid_flag_value", "runtime_adapter_enabled_without_brokers", "auth_json_or_keychain_read_detected", "network_call_detected", "secret_scan_failed"):
            self.assertIn(case, content["fail_closed_cases"])


if __name__ == "__main__":
    unittest.main()
