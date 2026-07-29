import json
import unittest

from tools.phase_1c_a4_e2b_synthetic_isolation_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    validate_contract,
)


class Phase1CA4E2BSyntheticIsolationValidatorTests(unittest.TestCase):
    def test_a4_contract_validates_without_execution_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["backend"], "e2b_sandbox")
        self.assertEqual(result["owner_approval_command"], EXPECTED_APPROVAL_COMMAND)
        self.assertEqual(result["owner_approval_command_sha256"], EXPECTED_APPROVAL_COMMAND_SHA)
        self.assertFalse(result["execution_approved"])
        self.assertFalse(result["provider_api_calls_allowed_before_approval"])
        self.assertFalse(result["sandbox_creation_allowed_without_approval"])
        self.assertEqual(result["next_gate"], "PHASE_1C_A4_OWNER_APPROVAL_REQUIRED")

    def test_a4_contract_forbids_real_credentials_and_sensitive_envs(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]

        self.assertFalse(content["real_credentials_allowed"])
        self.assertFalse(content["auth_files_read_allowed"])
        self.assertFalse(content["keychain_read_allowed"])
        self.assertFalse(content["environment_value_dump_allowed"])
        self.assertEqual(
            content["allowed_synthetic_environment_keys"],
            ["PANKSTER_PROFILE_ID", "PANKSTER_SYNTHETIC_MODEL_TOKEN", "PANKSTER_NETWORK_POLICY"],
        )
        self.assertIn("OPENAI_*", content["forbidden_environment_key_patterns"])
        self.assertIn("ANTHROPIC_*", content["forbidden_environment_key_patterns"])
        self.assertIn("TELEGRAM_*", content["forbidden_environment_key_patterns"])

    def test_a4_contract_requires_deny_all_and_child_env_proofs(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        proofs = contract["contract_content"]["required_proofs"]

        self.assertTrue(proofs["sandbox_created_with_deny_all_before_user_code"])
        self.assertTrue(proofs["application_level_outbound_denial_observed"])
        self.assertTrue(proofs["terminal_child_environment_sanitized"])
        self.assertTrue(proofs["code_execution_child_environment_sanitized"])
        self.assertTrue(proofs["mcp_child_environment_sanitized_or_not_available_fail_closed"])
        self.assertTrue(proofs["delegation_child_environment_sanitized_or_not_available_fail_closed"])
        self.assertTrue(proofs["sandbox_destroyed_after_probe"])

    def test_a4_contract_fails_closed_before_sandbox_creation(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        proofs = content["required_proofs"]

        self.assertTrue(content["network_policy_required_before_user_code"])
        self.assertEqual(content["network_policy"], "deny_all_outbound")
        self.assertTrue(proofs["policy_absent_fails_closed_before_sandbox_creation"])
        self.assertTrue(proofs["policy_invalid_fails_closed_before_sandbox_creation"])

    def test_a4_approval_command_is_exact(self):
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND,
            "APPROVE_PHASE_1C_E2B_SYNTHETIC_ISOLATION_PROOF:"
            "p1c-20260722-e2bproofa4:"
            "0764a641d0e2b9dfea863eb3ce28703706ba5688d38328b7c06e6fcb85574314",
        )
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND_SHA,
            "8588f01605d122707be0a39f58640d5fa35e2302148dedbf9bc42d824e2494b9",
        )


if __name__ == "__main__":
    unittest.main()
