import json
import unittest
from unittest.mock import patch

from tools.phase_1c_a7_e2b_synthetic_proof_with_sdk_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_APPROVAL_COMMAND,
    EXPECTED_APPROVAL_COMMAND_SHA,
    EXPECTED_ENV_ALLOWLIST,
    EXPECTED_VENV_PYTHON,
    validate_contract,
)


class Phase1CA7E2BSyntheticProofWithSDKValidatorTests(unittest.TestCase):
    @patch("tools.phase_1c_a7_e2b_synthetic_proof_with_sdk_validator._venv_e2b_version", return_value="2.34.0")
    def test_a7_contract_validates_without_execution_approval(self, _version):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["owner_approval_command"], EXPECTED_APPROVAL_COMMAND)
        self.assertEqual(result["owner_approval_command_sha256"], EXPECTED_APPROVAL_COMMAND_SHA)
        self.assertFalse(result["provider_api_calls_approved"])
        self.assertFalse(result["sandbox_creation_approved"])
        self.assertTrue(result["e2b_control_plane_credential_allowed_after_approval"])
        self.assertFalse(result["provider_credential_value_printed"])

    def test_a7_sdk_and_runner_are_pinned(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]

        self.assertEqual(content["sdk"]["venv_python"], EXPECTED_VENV_PYTHON)
        self.assertEqual(content["sdk"]["version"], "2.34.0")
        self.assertEqual(content["execution"]["runner_path"], "tools/phase_1c_a4_e2b_synthetic_proof_runner.py")
        self.assertEqual(content["execution"]["runner_mode"], "execute-synthetic-proof")

    def test_a7_runner_environment_is_allowlisted(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        allowlist = contract["contract_content"]["execution"]["runner_process_environment_allowlist"]

        self.assertEqual(allowlist, EXPECTED_ENV_ALLOWLIST)
        self.assertIn("E2B_API_KEY", allowlist)
        self.assertIn("NO_PROXY", allowlist)
        self.assertIn("no_proxy", allowlist)
        self.assertNotIn("OPENAI_API_KEY", allowlist)
        self.assertNotIn("ANTHROPIC_API_KEY", allowlist)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", allowlist)

    def test_a7_sandbox_policy_is_synthetic_and_deny_internet(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        policy = contract["contract_content"]["execution"]["sandbox_create_policy"]

        self.assertFalse(policy["allow_internet_access"])
        self.assertEqual(
            set(policy["envs"]),
            {"PANKSTER_PROFILE_ID", "PANKSTER_SYNTHETIC_MODEL_TOKEN", "PANKSTER_NETWORK_POLICY"},
        )
        self.assertEqual(policy["envs"]["PANKSTER_SYNTHETIC_MODEL_TOKEN"], "fake-profile-model-token")

    def test_a7_forbids_model_and_root_credentials(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        forbidden = contract["contract_content"]["forbidden_credentials"]
        e2b_credential = contract["contract_content"]["e2b_control_plane_credential"]

        self.assertTrue(forbidden["model_provider_credentials"])
        self.assertTrue(forbidden["root_auth_json"])
        self.assertTrue(forbidden["root_credential_pool"])
        self.assertTrue(forbidden["environment_value_dump"])
        self.assertEqual(e2b_credential["env_name"], "E2B_API_KEY")
        self.assertTrue(e2b_credential["allowed_after_approval"])
        self.assertFalse(e2b_credential["value_printed"])
        self.assertFalse(e2b_credential["passed_to_sandbox"])

    def test_a7_approval_command_is_exact(self):
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND,
            "APPROVE_PHASE_1C_E2B_SYNTHETIC_PROOF_WITH_SDK:"
            "p1c-20260722-e2bproofa7:"
            "2537f7550e839bfdfc60ffa158de755185cb1e545e7311cb828439a207791d79",
        )
        self.assertEqual(
            EXPECTED_APPROVAL_COMMAND_SHA,
            "abc50729f3ed6c6c302d2ef2d78882474d2d3ca74d09ae9a0cf246a74a386f22",
        )


if __name__ == "__main__":
    unittest.main()
