import json
import unittest

from tools.phase_1c_a10_runtime_adapter_design_validator import DEFAULT_REVIEW, validate_review


class Phase1CA10RuntimeAdapterDesignValidatorTests(unittest.TestCase):
    def test_a10_review_validates_without_production_or_implementation_approval(self):
        result = validate_review()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "RUNTIME_ADAPTER_DESIGN_ACCEPTED_FOR_IMPLEMENTATION_PLANNING_NOT_PRODUCTION")
        self.assertEqual(result["status"], "DESIGN_REVIEW_COMPLETE_NO_IMPLEMENTATION_APPROVED")
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertEqual(result["next_gate"], "A11_PRODUCTION_PROFILE_POLICY_CONTRACT")

    def test_environment_sanitizer_preserves_proxy_and_applies_to_children(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        sanitizer = review["decision_content"]["runtime_adapter_components"]["environment_sanitizer"]

        self.assertIn("NO_PROXY", sanitizer["preserve_keys"])
        self.assertIn("no_proxy", sanitizer["preserve_keys"])
        self.assertIn("PANKSTER_GRANT_IDS", sanitizer["pankster_keys"])
        for target in ("terminal", "code_execution", "delegate_task", "mcp", "background_process", "retry", "reclaim", "restart"):
            self.assertIn(target, sanitizer["applies_to"])
        for denied in ("*_KEY", "*_TOKEN", "ANTHROPIC_*", "OPENAI_*", "TELEGRAM_*", "E2B_API_KEY"):
            self.assertIn(denied, sanitizer["mandatory_denylist"])
        self.assertFalse(sanitizer["secret_values_allowed"])

    def test_adapter_forbids_root_auth_pool_oauth_and_provider_secret_flow(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        contract = review["decision_content"]["credential_and_file_access_contract"]

        self.assertFalse(contract["root_auth_json_read_allowed"])
        self.assertFalse(contract["root_auth_json_fallback_allowed"])
        self.assertFalse(contract["root_credential_pool_materialization_allowed"])
        self.assertFalse(contract["profile_auth_store_write_allowed"])
        self.assertFalse(contract["oauth_refresh_allowed_in_adapter"])
        self.assertFalse(contract["provider_secret_in_env_allowed"])
        self.assertFalse(contract["provider_secret_in_argv_allowed"])
        self.assertFalse(contract["provider_secret_in_artifacts_allowed"])

    def test_lifecycle_retry_reclaim_restart_and_destroy_are_bound(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        lifecycle = review["decision_content"]["runtime_adapter_components"]["lifecycle_manager"]
        child_contract = review["decision_content"]["child_environment_contract"]

        self.assertTrue(lifecycle["destroy_idempotent"])
        self.assertTrue(lifecycle["retry_changes_attempt_id"])
        self.assertTrue(lifecycle["reclaim_must_revalidate_runtime_identity"])
        self.assertEqual(child_contract["retry"], "new_attempt_new_grants_sanitized_environment")
        self.assertEqual(child_contract["reclaim"], "revalidate_runtime_identity_before_reuse")
        self.assertEqual(child_contract["restart"], "new_runtime_identity_and_policy_revalidation_required")

    def test_required_fail_closed_and_security_tests_are_declared(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        content = review["decision_content"]

        for case in ("network_policy_missing", "env_denylist_violation", "broker_channel_unavailable", "evidence_recorder_unavailable"):
            self.assertIn(case, content["fail_closed_cases"])
        self.assertIn("environment_sanitizer_preserves_no_proxy_and_blocks_denylist", content["required_tests"]["unit"])
        self.assertIn("synthetic_retry_reclaim_restart_preserve_security_contract", content["required_tests"]["integration_synthetic"])
        self.assertIn("adapter_never_passes_provider_secret_to_env_argv_artifacts_or_evidence", content["required_tests"]["security"])


if __name__ == "__main__":
    unittest.main()
