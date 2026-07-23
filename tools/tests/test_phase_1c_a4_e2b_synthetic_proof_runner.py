import sys
import types
import unittest
from unittest.mock import patch

from tools import phase_1c_a4_e2b_synthetic_proof_runner as runner


class Phase1CA4E2BSyntheticProofRunnerTests(unittest.TestCase):
    def test_exact_approval_command_is_required(self):
        with self.assertRaisesRegex(runner.Phase1CA4ProofError, "OWNER_APPROVAL_COMMAND_MISMATCH"):
            runner.validate_owner_approval("APPROVE_PHASE_1C_E2B_SYNTHETIC_ISOLATION_PROOF:wrong")

    def test_preflight_does_not_check_provider_credential_when_sdk_missing(self):
        with patch.object(runner, "_sdk_available", return_value=False), patch.object(
            runner,
            "_credential_name_present",
            side_effect=AssertionError("credential presence must not be checked without SDK"),
        ):
            result = runner.preflight(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["execution_approved"])
        self.assertFalse(result["dependency_install_allowed"])
        self.assertFalse(result["e2b_sdk_available"])
        self.assertFalse(result["provider_credential_presence_checked"])
        self.assertFalse(result["provider_credential_name_present"])
        self.assertFalse(result["provider_credential_value_printed"])
        self.assertFalse(result["sandbox_created"])

    def test_execute_fails_closed_before_credentials_when_sdk_missing(self):
        with patch.object(runner, "_sdk_available", return_value=False), patch.object(
            runner,
            "_credential_name_present",
            side_effect=AssertionError("credential presence must not be checked without SDK"),
        ):
            with self.assertRaisesRegex(runner.Phase1CA4ProofError, "E2B_SDK_NOT_AVAILABLE"):
                runner.execute_synthetic_proof(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

    def test_execute_requires_provider_credential_name_only_after_sdk_available(self):
        with patch.object(runner, "_sdk_available", return_value=True), patch.object(
            runner,
            "_credential_name_present",
            return_value=False,
        ):
            with self.assertRaisesRegex(runner.Phase1CA4ProofError, "E2B_API_KEY_NOT_CONFIGURED"):
                runner.execute_synthetic_proof(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

    def test_safe_text_redacts_sensitive_named_lines(self):
        text = runner._safe_text("normal\nOPENAI_API_KEY=secret\nTELEGRAM_TOKEN=secret\nok")

        self.assertEqual(text, "normal\n[REDACTED_SENSITIVE_LINE]\n[REDACTED_SENSITIVE_LINE]\nok")

    def test_execute_uses_synthetic_env_and_destroys_sandbox_with_mock_sdk(self):
        class FakeResult:
            stdout = (
                '{"application_level_outbound_denial_observed":true,'
                '"code_execution_child_environment_sanitized":true,'
                '"delegation_child_environment_sanitized_or_not_available_fail_closed":true,'
                '"mcp_child_environment_sanitized_or_not_available_fail_closed":true,'
                '"sandbox_cannot_read_root_auth_json":true,'
                '"sandbox_environment_contains_only_allowlisted_synthetic_keys":true,'
                '"terminal_child_environment_sanitized":true}'
            )
            stderr = ""
            exit_code = 0

        class FakeCommands:
            def __init__(self):
                self.command = None

            def run(self, command):
                self.command = command
                return FakeResult()

        class FakeSandbox:
            created_kwargs = None
            killed = False

            def __init__(self):
                self.sandbox_id = "synthetic-sandbox-id"
                self.commands = FakeCommands()

            @classmethod
            def create(cls, **kwargs):
                cls.created_kwargs = kwargs
                return cls()

            def kill(self):
                type(self).killed = True
                return True

        fake_module = types.SimpleNamespace(Sandbox=FakeSandbox)
        with patch.object(runner, "_sdk_available", return_value=True), patch.object(
            runner,
            "_credential_name_present",
            return_value=True,
        ), patch.dict(sys.modules, {"e2b": fake_module}):
            result = runner.execute_synthetic_proof(runner.DEFAULT_CONTRACT, runner.EXPECTED_APPROVAL_COMMAND)

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["sandbox_created"])
        self.assertTrue(FakeSandbox.killed)
        self.assertEqual(FakeSandbox.created_kwargs["allow_internet_access"], False)
        self.assertEqual(
            FakeSandbox.created_kwargs["envs"],
            {
                "PANKSTER_PROFILE_ID": "synthetic-e2b-proof",
                "PANKSTER_SYNTHETIC_MODEL_TOKEN": "fake-profile-model-token",
                "PANKSTER_NETWORK_POLICY": "deny_all",
            },
        )
        self.assertEqual(FakeSandbox.created_kwargs["metadata"]["pankster_synthetic_only"], "true")


if __name__ == "__main__":
    unittest.main()
