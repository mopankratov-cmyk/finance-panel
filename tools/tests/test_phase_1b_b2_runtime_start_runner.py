import os
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import phase_1b_b2_runtime_start_runner as runner


class Phase1BB2RuntimeStartRunnerTests(unittest.TestCase):
    def test_owner_command_is_hash_bound(self):
        command = runner.expected_owner_command("p1b-20260722-syntheticruntimeb2", "a" * 64)

        self.assertEqual(
            command,
            "APPROVE_SYNTHETIC_RUNTIME_START:p1b-20260722-syntheticruntimeb2:" + "a" * 64,
        )

    def test_admin_command_is_narrow_and_does_not_authorize_workload(self):
        command = runner.build_admin_command(
            "docs/program/PHASE_1B_B2_SYNTHETIC_RUNTIME_START_APPROVAL_RECORD.json",
            script_path=Path("/repo/tools/phase_1b_b2_runtime_start_runner.py"),
        )

        joined = " ".join(command)
        self.assertEqual(command[:4], ["sudo", os.sys.executable, "/repo/tools/phase_1b_b2_runtime_start_runner.py", "--mode"])
        self.assertIn("execute-start", command)
        self.assertIn("--approval-record", command)
        self.assertNotIn("container run", joined)
        self.assertNotIn("container create", joined)
        self.assertNotIn("registry login", joined)

    def test_execute_start_requires_admin_before_approval_record(self):
        with patch.object(runner.os, "geteuid", return_value=501), patch.object(
            runner,
            "validate_contract",
            side_effect=AssertionError("contract should not be read before admin check"),
        ):
            with self.assertRaisesRegex(runner.RuntimeStartError, "ADMIN_AUTHORIZATION_REQUIRED"):
                runner.execute_start(runner.DEFAULT_CONTRACT, Path("/missing/approval.json"))

    def test_sanitized_env_preserves_no_proxy_but_drops_credential_keys(self):
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
