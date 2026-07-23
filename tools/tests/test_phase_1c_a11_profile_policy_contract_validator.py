import json
import unittest

from tools.phase_1c_a11_profile_policy_contract_validator import DEFAULT_CONTRACT, validate_contract


class Phase1CA11ProfilePolicyContractValidatorTests(unittest.TestCase):
    def test_a11_contract_validates_without_runtime_or_implementation_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "PRODUCTION_PROFILE_POLICY_CONTRACT_READY_FOR_SYNTHETIC_TEST_PLANNING_NOT_RUNTIME")
        self.assertEqual(result["status"], "PROFILE_POLICY_CONTRACT_COMPLETE_NO_PRODUCTION_APPROVAL")
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertEqual(result["next_gate"], "A12_INTEGRATION_TEST_PLAN_WITH_SYNTHETIC_ONLY_FIXTURES")

    def test_named_profiles_remain_created_but_disabled(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        profiles = contract["decision_content"]["profiles"]

        for profile_id in ("dev-director", "content-director"):
            profile = profiles[profile_id]
            self.assertEqual(profile["state"], "CREATED_BUT_DISABLED")
            self.assertFalse(profile["enabled"])
            self.assertTrue(profile["runtime_isolation_required"])
            self.assertFalse(profile["root_auth_fallback_allowed"])
            self.assertFalse(profile["root_credential_pool_materialization_allowed"])
            self.assertEqual(profile["models"], [])

    def test_profile_schema_rejects_secret_material_and_requires_allowlists(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        schema = contract["decision_content"]["profile_policy_schema"]

        for field in ("model_provider_allowlist", "model_allowlist", "operation_allowlist", "budget", "credential_reference_allowlist"):
            self.assertIn(field, schema["required_fields"])
        for field in ("api_key", "access_token", "refresh_token", "authorization_header", "root_credential_pool"):
            self.assertIn(field, schema["forbidden_fields"])
        self.assertFalse(schema["enabled_default"])
        self.assertEqual(schema["missing_policy_behavior"], "deny")

    def test_minimal_model_auth_uses_grant_reference_only(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        model_auth = contract["decision_content"]["minimal_model_auth_contract"]

        self.assertEqual(model_auth["delivery_mechanism"], "host_side_broker_grant_reference_only")
        self.assertFalse(model_auth["grant_reference_secret"])
        self.assertIn("runtime_identity_hash", model_auth["permitted_scope_fields"])
        for forbidden in ("provider_api_key", "provider_access_token", "authorization_header", "root_auth_json", "credential_store_path"):
            self.assertIn(forbidden, model_auth["forbidden_material"])
        self.assertEqual(model_auth["grant_replay_behavior"], "deny")

    def test_environment_credential_and_security_tests_cover_sensitive_paths(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["decision_content"]

        self.assertIn("NO_PROXY", content["environment_policy"]["preserve_keys"])
        self.assertIn("no_proxy", content["environment_policy"]["preserve_keys"])
        for denied in ("*_KEY", "*_TOKEN", "TELEGRAM_*", "GITEA_*", "SUPABASE_*", "ANTHROPIC_*", "GLM_*"):
            self.assertIn(denied, content["environment_policy"]["mandatory_denylist"])
        self.assertFalse(content["credential_policy"]["root_auth_json_fallback_allowed_for_named_profiles"])
        self.assertFalse(content["credential_policy"]["root_credential_pool_materialization_allowed"])
        self.assertFalse(content["credential_policy"]["oauth_refresh_by_profile_worker_allowed"])
        self.assertIn("terminal_code_execution_delegate_mcp_background_children_sanitized", content["required_tests"]["security"])
        self.assertIn("retry_reclaim_restart_preserve_policy_and_attempt_binding", content["required_tests"]["security"])


if __name__ == "__main__":
    unittest.main()
