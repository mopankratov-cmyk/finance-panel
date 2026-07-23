import json
import unittest

from tools.phase_1c_a9_broker_spec_validator import DEFAULT_SPEC, validate_spec


class Phase1CA9BrokerSpecValidatorTests(unittest.TestCase):
    def test_a9_spec_validates_without_implementation_approval(self):
        result = validate_spec()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "HOST_SIDE_MODEL_AND_CREDENTIAL_BROKER_REQUIRED_BEFORE_PRODUCTION_RUNTIME")
        self.assertEqual(result["status"], "SPEC_COMPLETE_NO_IMPLEMENTATION_APPROVED")
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertEqual(result["next_gate"], "A10_RUNTIME_ADAPTER_DESIGN_REVIEW")

    def test_grant_contract_forbids_secret_fields_and_non_bearer_grants(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        grant = spec["decision_content"]["grant_contract"]

        for field in ("api_key", "access_token", "refresh_token", "authorization_header", "root_credential_pool"):
            self.assertIn(field, grant["forbidden_fields"])
        self.assertFalse(grant["grant_reference_is_bearer_secret"])
        self.assertTrue(grant["requires_runtime_identity_binding"])
        self.assertTrue(grant["requires_attempt_binding"])
        self.assertEqual(grant["ttl_max_seconds"], 900)

    def test_sandbox_runtime_preserves_proxy_and_denies_sensitive_env(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        runtime = spec["decision_content"]["sandbox_runtime_contract"]

        self.assertIn("NO_PROXY", runtime["environment_allowlist"])
        self.assertIn("no_proxy", runtime["environment_allowlist"])
        self.assertIn("PANKSTER_GRANT_IDS", runtime["environment_allowlist"])
        for pattern in ("*_KEY", "*_TOKEN", "ANTHROPIC_*", "OPENAI_*", "TELEGRAM_*", "E2B_API_KEY"):
            self.assertIn(pattern, runtime["mandatory_env_denylist"])
        self.assertFalse(runtime["root_auth_fallback_allowed"])
        self.assertFalse(runtime["root_credential_pool_materialization_allowed"])
        self.assertFalse(runtime["real_model_credentials_in_sandbox_allowed"])

    def test_model_broker_is_host_side_and_response_is_secret_free(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        content = spec["decision_content"]
        model_broker = content["components"]["model_broker"]
        contract = content["model_broker_contract"]

        self.assertFalse(model_broker["runs_inside_sandbox"])
        self.assertTrue(contract["budget_enforced_before_provider_call"])
        self.assertTrue(contract["model_allowlist_enforced_before_provider_call"])
        for field in ("provider_secret_value", "authorization_header", "raw_request_headers", "raw_response_headers"):
            self.assertIn(field, contract["response_forbidden_fields"])

    def test_required_fail_closed_and_security_tests_are_declared(self):
        spec = json.loads(DEFAULT_SPEC.read_text(encoding="utf-8"))
        content = spec["decision_content"]

        for case in ("broker_unavailable", "oauth_refresh_conflict", "grant_replay_detected", "audit_sink_unavailable"):
            self.assertIn(case, content["fail_closed_cases"])
        self.assertIn("oauth_refresh_owner_only_cas", content["required_tests"]["unit"])
        self.assertIn("retry_reclaim_preserves_grant_attempt_binding", content["required_tests"]["integration_synthetic"])
        self.assertIn(
            "mcp_terminal_code_delegation_children_do_not_receive_provider_credentials",
            content["required_tests"]["security"],
        )


if __name__ == "__main__":
    unittest.main()
