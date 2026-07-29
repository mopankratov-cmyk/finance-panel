import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools import phase_1c_a5_e2b_sdk_wheelhouse_runner as runner


class Phase1CA5E2BSDKWheelhouseRunnerTests(unittest.TestCase):
    def test_exact_approval_command_required(self):
        with self.assertRaisesRegex(runner.Phase1CA5WheelhouseError, "OWNER_APPROVAL_COMMAND_MISMATCH"):
            runner.validate_owner_approval("APPROVE_PHASE_1C_E2B_SDK_WHEELHOUSE_LOCK:wrong")

    def test_pip_command_is_download_only_and_binary_only(self):
        command = runner.build_pip_download_command(Path("/tmp/wheelhouse"))
        joined = " ".join(command)

        self.assertIn("download", command)
        self.assertIn("--only-binary", command)
        self.assertIn(":all:", command)
        self.assertIn("e2b==2.34.0", command)
        self.assertNotIn(" install ", f" {joined} ")
        self.assertNotIn(" uninstall ", f" {joined} ")
        runner.validate_pip_command_scope(command)

    def test_sanitized_env_preserves_no_proxy_and_drops_pip_credentials(self):
        with patch.dict(
            runner.os.environ,
            {
                "PATH": "/usr/bin",
                "NO_PROXY": "localhost",
                "no_proxy": "127.0.0.1",
                "PIP_INDEX_URL": "https://token@example.invalid/simple",
                "E2B_API_KEY": "redacted",
            },
            clear=True,
        ):
            env = runner._sanitized_env()

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["NO_PROXY"], "localhost")
        self.assertEqual(env["no_proxy"], "127.0.0.1")
        self.assertNotIn("PIP_INDEX_URL", env)
        self.assertNotIn("E2B_API_KEY", env)
        self.assertEqual(env["PIP_NO_INPUT"], "1")

    def test_preflight_does_not_install_import_or_call_provider(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            result = runner.preflight(
                runner.DEFAULT_CONTRACT,
                runner.EXPECTED_APPROVAL_COMMAND,
                Path(tmpdir),
            )

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["dependency_download_approved"])
        self.assertFalse(result["dependency_install_allowed"])
        self.assertFalse(result["dependency_import_allowed"])
        self.assertFalse(result["provider_api_calls_allowed"])
        self.assertFalse(result["sandbox_creation_allowed"])
        self.assertEqual(result["pip_command_scope"], "download-only")

    def test_execute_download_writes_manifest_from_mocked_pip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            wheelhouse = Path(tmpdir) / "wheelhouse"
            wheelhouse.mkdir()
            wheel = wheelhouse / "e2b-2.34.0-py3-none-any.whl"
            wheel.write_bytes(b"fake-wheel")
            expected_sha = runner.hashlib.sha256(b"fake-wheel").hexdigest()
            completed = Mock(returncode=0, stdout="Saved wheel", stderr="")
            manifest_output = Path(tmpdir) / "manifest.json"

            with patch.object(runner, "EXPECTED_PRIMARY_WHEEL_SHA", expected_sha), patch.object(
                runner.subprocess,
                "run",
                return_value=completed,
            ):
                manifest = runner.execute_download(
                    runner.DEFAULT_CONTRACT,
                    runner.EXPECTED_APPROVAL_COMMAND,
                    wheelhouse=wheelhouse,
                    manifest_output=manifest_output,
                )
            self.assertTrue(manifest_output.exists())
            written = json.loads(manifest_output.read_text(encoding="utf-8"))

        self.assertEqual(manifest["result"], "PASS")
        self.assertEqual(manifest["wheels"][0]["filename"], "e2b-2.34.0-py3-none-any.whl")
        self.assertTrue(manifest["primary_wheel_sha_verified"])
        self.assertEqual(written["result"], "PASS")


if __name__ == "__main__":
    unittest.main()
