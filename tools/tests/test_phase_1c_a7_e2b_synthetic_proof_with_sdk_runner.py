import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools import phase_1c_a7_e2b_synthetic_proof_with_sdk_runner as runner


class Phase1CA7E2BSyntheticProofWithSDKRunnerTests(unittest.TestCase):
    def test_exact_approval_command_required(self):
        with self.assertRaisesRegex(runner.Phase1CA7ExecutionError, "OWNER_APPROVAL_COMMAND_MISMATCH"):
            runner.validate_owner_approval("APPROVE_PHASE_1C_E2B_SYNTHETIC_PROOF_WITH_SDK:wrong")

    def test_runner_env_is_allowlisted_and_preserves_e2b_key_name(self):
        with patch.dict(
            runner.os.environ,
            {
                "PATH": "/usr/bin",
                "NO_PROXY": "localhost",
                "E2B_API_KEY": "redacted",
                "OPENAI_API_KEY": "redacted",
                "SUPABASE_SERVICE_ROLE_KEY": "redacted",
            },
            clear=True,
        ):
            env = runner._runner_env()

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["NO_PROXY"], "localhost")
        self.assertIn("E2B_API_KEY", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", env)

    def test_preflight_reports_missing_key_without_value(self):
        with patch.object(runner, "_venv_e2b_version", return_value="2.34.0"), patch.dict(
            runner.os.environ,
            {"PATH": "/usr/bin"},
            clear=True,
        ):
            result = runner.preflight(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["e2b_api_key_name_present"])
        self.assertFalse(result["provider_credential_value_printed"])
        self.assertTrue(result["runner_env_allowlisted"])

    def test_execute_fails_closed_before_sandbox_when_key_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir, patch.object(
            runner,
            "_venv_e2b_version",
            return_value="2.34.0",
        ), patch.dict(runner.os.environ, {"PATH": "/usr/bin"}, clear=True):
            manifest_output = Path(tmpdir) / "manifest.json"
            manifest = runner.execute_proof(
                runner.DEFAULT_CONTRACT,
                runner.EXPECTED_APPROVAL_COMMAND,
                manifest_output=manifest_output,
            )
            written = json.loads(manifest_output.read_text(encoding="utf-8"))

        self.assertEqual(manifest["result"], "FAIL_CLOSED")
        self.assertEqual(manifest["reason"], "E2B_API_KEY_NOT_CONFIGURED")
        self.assertFalse(manifest["provider_api_calls_performed"])
        self.assertFalse(manifest["sandbox_created"])
        self.assertFalse(manifest["provider_credential_value_printed"])
        self.assertEqual(written["result"], "FAIL_CLOSED")

    def test_execute_invokes_a4_runner_when_key_present(self):
        completed = Mock(
            returncode=0,
            stdout=json.dumps({"result": "PASS", "sandbox_created": True, "sandbox_destroyed": True}),
            stderr="",
        )
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            if "importlib.metadata" in " ".join(command):
                return Mock(returncode=0, stdout="2.34.0\n", stderr="")
            return completed

        with tempfile.TemporaryDirectory() as tmpdir, patch.object(
            runner.subprocess,
            "run",
            side_effect=fake_run,
        ), patch.dict(runner.os.environ, {"PATH": "/usr/bin", "E2B_API_KEY": "redacted"}, clear=True):
            manifest = runner.execute_proof(
                runner.DEFAULT_CONTRACT,
                runner.EXPECTED_APPROVAL_COMMAND,
                manifest_output=Path(tmpdir) / "manifest.json",
            )

        self.assertEqual(manifest["result"], "PASS")
        self.assertTrue(manifest["provider_api_calls_performed"])
        self.assertTrue(manifest["sandbox_created"])
        self.assertTrue(manifest["sandbox_destroyed"])
        self.assertIn(str(runner.A4_RUNNER), calls[-1])


if __name__ == "__main__":
    unittest.main()
