import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import phase_1b_b1_install_runner as runner


class Phase1BB1InstallRunnerTests(unittest.TestCase):
    def test_build_admin_command_is_narrow_and_does_not_start_runtime(self):
        command = runner.build_admin_command(
            "/tmp/container-1.1.0-installer-signed.pkg",
            script_path=Path("/repo/tools/phase_1b_b1_install_runner.py"),
        )

        joined = " ".join(command)
        self.assertEqual(command[:4], ["sudo", os.sys.executable, "/repo/tools/phase_1b_b1_install_runner.py", "--mode"])
        self.assertIn("execute-install", command)
        self.assertIn("--pkg", command)
        self.assertNotIn("container system start", joined)
        self.assertNotIn("container-apiserver", joined)

    def test_validate_package_path_rejects_missing_paths(self):
        with self.assertRaisesRegex(runner.InstallRunnerError, "PACKAGE_NOT_FOUND"):
            runner.validate_package_path(Path("/definitely/missing/container-1.1.0-installer-signed.pkg"))

    def test_validate_package_path_rejects_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            target = tmp_path / "target.pkg"
            link = tmp_path / "container-1.1.0-installer-signed.pkg"
            target.write_bytes(b"not a package")
            link.symlink_to(target)

            with self.assertRaisesRegex(runner.InstallRunnerError, "PACKAGE_SYMLINK_REJECTED"):
                runner.validate_package_path(link)

    def test_execute_install_denies_without_root_before_package_access(self):
        with patch.object(runner.os, "geteuid", return_value=501), patch.object(
            runner,
            "validate_synthetic_gate",
            side_effect=AssertionError("synthetic gate should not run before admin check"),
        ):
            with self.assertRaisesRegex(runner.InstallRunnerError, "ADMIN_AUTHORIZATION_REQUIRED"):
                runner.execute_install(
                    runner.DEFAULT_MANIFEST,
                    runner.DEFAULT_APPROVAL_RECORD,
                    Path("/definitely/missing.pkg"),
                    runner.DEFAULT_INSTALL_TARGET,
                )

    def test_sanitized_env_preserves_no_proxy_but_drops_secret_shaped_keys(self):
        with patch.dict(
            runner.os.environ,
            {
                "PATH": "/usr/bin",
                "HOME": "/Users/example",
                "NO_PROXY": "localhost",
                "no_proxy": "127.0.0.1",
                "OPENAI_API_KEY": "redacted-openai-key",
                "ANTHROPIC_API_KEY": "secret",
            },
            clear=True,
        ):
            env = runner._sanitized_env()

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["NO_PROXY"], "localhost")
        self.assertEqual(env["no_proxy"], "127.0.0.1")
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("ANTHROPIC_API_KEY", env)


if __name__ == "__main__":
    unittest.main()
