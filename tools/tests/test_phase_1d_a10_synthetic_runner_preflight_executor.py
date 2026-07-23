import json
import tempfile
import unittest
from pathlib import Path

from tools import phase_1d_a10_synthetic_runner_preflight_executor as executor


class Phase1DA10SyntheticRunnerPreflightExecutorTests(unittest.TestCase):
    def test_exact_approval_command_required(self):
        with self.assertRaisesRegex(executor.Phase1DA10ExecutionError, "OWNER_APPROVAL_COMMAND_MISMATCH"):
            executor.validate_owner_approval("APPROVE_PHASE_1D_SYNTHETIC_RUNNER_PREFLIGHT_EXECUTION:wrong")

    def test_execute_preflight_passes_and_writes_sanitized_manifest(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = Path(tmpdir) / "manifest.json"
            manifest = executor.execute_preflight(executor.EXPECTED_APPROVAL, manifest_output=manifest_path)
            written = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(manifest["result"], "PASS")
        self.assertEqual(written["result"], "PASS")
        self.assertTrue(manifest["synthetic_only"])
        self.assertTrue(manifest["local_dry_run_only"])
        self.assertTrue(manifest["sanitized"])

    def test_execute_preflight_never_performs_forbidden_runtime_actions(self):
        manifest = executor.execute_preflight(executor.EXPECTED_APPROVAL, manifest_output=None)

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
            "dependency_changes_performed",
            "oauth_refresh_performed",
            "provider_credential_value_printed",
        ):
            self.assertFalse(manifest[field])

    def test_execute_preflight_proves_sanitizer_and_fail_closed_adapter_paths(self):
        manifest = executor.execute_preflight(executor.EXPECTED_APPROVAL, manifest_output=None)
        proofs = manifest["proofs"]
        result = manifest["sanitized_result"]

        self.assertTrue(proofs["enabled_runtime_adapter_preserved_no_proxy"])
        self.assertTrue(proofs["enabled_runtime_adapter_denied_sensitive_keys"])
        self.assertEqual(result["enabled_adapter_denial_reason"], "SANDBOX_LAUNCH_NOT_IMPLEMENTED")
        self.assertEqual(result["broker_channel_denial_reason"], "BROKER_CHANNEL_NOT_IMPLEMENTED")
        self.assertIn("NO_PROXY", result["sanitized_env_keys"])
        self.assertIn("no_proxy", result["sanitized_env_keys"])

    def test_execute_preflight_output_contains_key_names_but_not_secret_values(self):
        manifest = executor.execute_preflight(executor.EXPECTED_APPROVAL, manifest_output=None)
        text = json.dumps(manifest, sort_keys=True)

        self.assertIn("OPENAI_API_KEY", text)
        self.assertIn("TELEGRAM_BOT_TOKEN", text)
        self.assertNotIn("synthetic-redacted", text)

    def test_executor_source_has_no_subprocess_or_network_imports(self):
        source = Path(executor.__file__).read_text(encoding="utf-8")

        self.assertNotIn("import subprocess", source)
        self.assertNotIn("import requests", source)
        self.assertNotIn("import httpx", source)
        self.assertNotIn("import socket", source)


if __name__ == "__main__":
    unittest.main()
