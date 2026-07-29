import os
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import phase_1b_b3_kernel_provision_runner as runner


class Phase1BB3KernelProvisionRunnerTests(unittest.TestCase):
    def test_owner_command_is_hash_bound(self):
        command = runner.expected_owner_command("p1b-20260722-kernelprovisionb3", "b" * 64)

        self.assertEqual(
            command,
            "APPROVE_SYNTHETIC_KERNEL_PROVISION:p1b-20260722-kernelprovisionb3:" + "b" * 64,
        )

    def test_admin_command_does_not_start_runtime_or_recommended_download(self):
        command = runner.build_admin_command(
            "/tmp/kata-static-3.28.0-arm64.tar.zst",
            "docs/program/PHASE_1B_B3_KERNEL_PROVISIONING_APPROVAL_RECORD.json",
            script_path=Path("/repo/tools/phase_1b_b3_kernel_provision_runner.py"),
            contract_path=Path("/repo/docs/program/contract.json"),
        )

        joined = " ".join(command)
        self.assertIn("execute-provision", command)
        self.assertIn("--kata-archive", command)
        self.assertNotIn("container system start", joined)
        self.assertNotIn("--recommended", joined)
        self.assertNotIn("container run", joined)
        self.assertNotIn("registry login", joined)

    def test_execute_provision_requires_admin_before_artifact_access(self):
        with patch.object(runner.os, "geteuid", return_value=501), patch.object(
            runner,
            "validate_contract",
            side_effect=AssertionError("contract should not be read before admin check"),
        ):
            with self.assertRaisesRegex(runner.KernelProvisionError, "ADMIN_AUTHORIZATION_REQUIRED"):
                runner.execute_provision(
                    runner.DEFAULT_CONTRACT,
                    Path("/missing/approval.json"),
                    Path("/missing/kata.tar.zst"),
                )

    def test_validate_archive_path_rejects_missing_path(self):
        with self.assertRaisesRegex(runner.KernelProvisionError, "KATA_ARCHIVE_NOT_FOUND"):
            runner.validate_archive_path(Path("/definitely/missing/kata-static-3.28.0-arm64.tar.zst"))

    def test_sanitized_env_preserves_no_proxy_but_drops_credentials(self):
        with patch.dict(
            runner.os.environ,
            {
                "PATH": "/usr/bin",
                "HOME": "/Users/example",
                "NO_PROXY": "localhost",
                "no_proxy": "127.0.0.1",
                "OPENAI_API_KEY": "redacted-openai-key",
                "SUPABASE_SERVICE_ROLE_KEY": "redacted",
            },
            clear=True,
        ):
            env = runner._sanitized_env()

        self.assertEqual(env["PATH"], "/usr/bin")
        self.assertEqual(env["NO_PROXY"], "localhost")
        self.assertEqual(env["no_proxy"], "127.0.0.1")
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", env)


if __name__ == "__main__":
    unittest.main()
