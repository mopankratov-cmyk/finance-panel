import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tools import phase_1c_a6_e2b_sdk_offline_install_runner as runner


class Phase1CA6E2BSDKOfflineInstallRunnerTests(unittest.TestCase):
    def test_exact_approval_command_required(self):
        with self.assertRaisesRegex(runner.Phase1CA6OfflineInstallError, "OWNER_APPROVAL_COMMAND_MISMATCH"):
            runner.validate_owner_approval("APPROVE_PHASE_1C_E2B_SDK_OFFLINE_INSTALL:wrong")

    def test_install_command_is_no_index_wheelhouse_only(self):
        command = runner.build_install_command(runner.DEFAULT_VENV, runner.DEFAULT_WHEELHOUSE)

        self.assertIn("install", command)
        self.assertIn("--no-index", command)
        self.assertIn("--find-links", command)
        self.assertIn(str(runner.DEFAULT_WHEELHOUSE), command)
        self.assertIn("e2b==2.34.0", command)
        self.assertNotIn("--index-url", command)
        self.assertNotIn("--extra-index-url", command)
        runner.validate_install_command_scope(command, runner.DEFAULT_WHEELHOUSE)

    def test_sanitized_env_drops_credentials_and_preserves_no_proxy(self):
        with patch.dict(
            runner.os.environ,
            {
                "PATH": "/usr/bin",
                "NO_PROXY": "localhost",
                "no_proxy": "127.0.0.1",
                "E2B_API_KEY": "redacted",
                "PIP_INDEX_URL": "https://token@example.invalid/simple",
            },
            clear=True,
        ):
            env = runner._sanitized_env()

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["NO_PROXY"], "localhost")
        self.assertEqual(env["no_proxy"], "127.0.0.1")
        self.assertEqual(env["PIP_NO_INDEX"], "1")
        self.assertNotIn("E2B_API_KEY", env)
        self.assertNotIn("PIP_INDEX_URL", env)

    def test_preflight_does_not_check_provider_credentials_or_allow_api(self):
        with patch.object(runner, "validate_wheelhouse", return_value=runner.DEFAULT_WHEELHOUSE):
            result = runner.preflight(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["dependency_install_approved"])
        self.assertFalse(result["pypi_allowed"])
        self.assertFalse(result["network_dependency_resolution_allowed"])
        self.assertFalse(result["provider_api_calls_allowed"])
        self.assertFalse(result["sandbox_creation_allowed"])
        self.assertFalse(result["provider_credential_presence_checked"])
        self.assertFalse(result["provider_credential_value_printed"])

    def test_execute_install_writes_manifest_from_mocked_commands(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            wheelhouse = root / "wheelhouse"
            wheelhouse.mkdir()
            (wheelhouse / "e2b-2.34.0-py3-none-any.whl").write_bytes(b"fake")
            venv = root / "venv"
            manifest_output = root / "manifest.json"

            def fake_run(command, *, timeout=180):
                command_text = " ".join(command)
                if "importlib.metadata" in command_text:
                    return Mock(returncode=0, stdout="2.34.0\n", stderr="")
                if "import e2b" in command_text:
                    return Mock(returncode=0, stdout="E2B_IMPORT_OK\n", stderr="")
                if command[:3] == ["python3", "-m", "venv"]:
                    (venv / "bin").mkdir(parents=True)
                    (venv / "bin" / "python").write_text("#!/bin/sh\n", encoding="utf-8")
                    return Mock(returncode=0, stdout="", stderr="")
                if "pip" in command:
                    return Mock(returncode=0, stdout="Successfully installed e2b-2.34.0", stderr="")
                raise AssertionError(command)

            with patch.object(runner, "DEFAULT_WHEELHOUSE", wheelhouse), patch.object(
                runner,
                "DEFAULT_VENV",
                venv,
            ), patch.object(runner, "EXPECTED_WHEELHOUSE", str(wheelhouse)), patch.object(
                runner,
                "EXPECTED_VENV",
                str(venv),
            ), patch.object(
                runner,
                "_run",
                side_effect=fake_run,
            ):
                manifest = runner.execute_install(
                    runner.DEFAULT_CONTRACT,
                    runner.EXPECTED_APPROVAL_COMMAND,
                    wheelhouse=wheelhouse,
                    venv=venv,
                    manifest_output=manifest_output,
                )
            written = json.loads(manifest_output.read_text(encoding="utf-8"))

        self.assertEqual(manifest["result"], "PASS")
        self.assertEqual(manifest["installed_e2b_version"], "2.34.0")
        self.assertTrue(manifest["offline_import_verification_passed"])
        self.assertFalse(manifest["provider_api_calls_performed"])
        self.assertFalse(manifest["sandbox_created"])
        self.assertEqual(written["result"], "PASS")


if __name__ == "__main__":
    unittest.main()
