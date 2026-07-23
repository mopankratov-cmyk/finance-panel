import json
import unittest

from tools.phase_1d_a10_synthetic_runner_preflight_validator import DEFAULT_EVIDENCE, DEFAULT_MANIFEST, validate_evidence


class Phase1DA10SyntheticRunnerPreflightValidatorTests(unittest.TestCase):
    def test_a10_evidence_validates_execution_manifest(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["next_gate"], "1D-A11_SYNTHETIC_PREFLIGHT_EXECUTION_REVIEW")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_a10_manifest_records_no_forbidden_runtime_side_effects(self):
        manifest = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))

        for field in (
            "provider_api_calls_performed",
            "model_api_calls_performed",
            "real_credentials_used",
            "auth_files_read",
            "keychain_read",
            "sandbox_created",
            "subprocess_launch_performed",
            "gateway_changed",
            "profile_started",
            "canary_started",
        ):
            self.assertFalse(manifest[field])
        self.assertTrue(manifest["synthetic_only"])
        self.assertTrue(manifest["local_dry_run_only"])
        self.assertTrue(manifest["sanitized"])

    def test_a10_evidence_proofs_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        proofs = evidence["decision_content"]["proofs_verified"]

        self.assertTrue(proofs)
        for value in proofs.values():
            self.assertTrue(value)

    def test_a10_manifest_preserves_no_proxy_and_denies_sensitive_key_names(self):
        manifest = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
        result = manifest["sanitized_result"]

        self.assertIn("NO_PROXY", result["sanitized_env_keys"])
        self.assertIn("no_proxy", result["sanitized_env_keys"])
        self.assertEqual(result["denied_key_names"], ["OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN"])

    def test_a10_evidence_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]

        self.assertEqual(tests["targeted_a10_executor_tests"]["result"], "PASS")
        self.assertEqual(tests["targeted_a10_executor_tests"]["tests"], 6)
        self.assertEqual(tests["targeted_a10_validator_tests"]["result"], "PASS")
        self.assertEqual(tests["targeted_a10_validator_tests"]["tests"], 5)


if __name__ == "__main__":
    unittest.main()
