import json
import unittest

from tools.phase_1c_a3_isolation_proof_contract_validator import DEFAULT_CONTRACT, validate_contract


class Phase1CA3IsolationProofContractValidatorTests(unittest.TestCase):
    def test_a3_contract_validates_without_execution_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["candidate_scope"], ["modal_sandbox", "e2b_sandbox"])
        self.assertFalse(result["execution_approved"])
        self.assertFalse(result["provider_api_calls_allowed_before_a4"])
        self.assertEqual(result["next_gate"], "PHASE_1C_A4_OWNER_APPROVAL_PACKET")

    def test_a3_contract_requires_all_isolation_proofs(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        proofs = contract["contract_content"]["required_proofs"]

        self.assertTrue(proofs["deny_all_network_before_worker_code"])
        self.assertTrue(proofs["policy_absent_fails_closed_before_worker_code"])
        self.assertTrue(proofs["policy_invalid_fails_closed_before_worker_code"])
        self.assertTrue(proofs["sandbox_receives_no_root_auth"])
        self.assertTrue(proofs["sandbox_receives_no_non_profile_credentials"])
        self.assertTrue(proofs["terminal_child_environment_sanitized"])
        self.assertTrue(proofs["code_execution_child_environment_sanitized"])
        self.assertTrue(proofs["mcp_child_environment_sanitized"])
        self.assertTrue(proofs["delegation_child_environment_sanitized"])
        self.assertTrue(proofs["application_level_network_denial_observed"])

    def test_a3_contract_allows_only_fake_synthetic_credentials(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        synthetic_credentials = contract["contract_content"]["synthetic_credentials"]

        self.assertTrue(synthetic_credentials["fake_profile_model_token_allowed"])
        self.assertFalse(synthetic_credentials["real_model_token_allowed"])
        self.assertFalse(synthetic_credentials["root_auth_json_allowed"])
        self.assertFalse(synthetic_credentials["root_credential_pool_allowed"])

    def test_a3_contract_forbids_pre_a4_side_effects(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]

        self.assertFalse(content["provider_api_calls_allowed_before_a4"])
        self.assertFalse(content["real_credentials_allowed"])
        self.assertFalse(content["production_profiles_allowed"])
        self.assertFalse(content["gateway_changes_allowed"])
        self.assertFalse(content["canary_allowed"])
        self.assertFalse(content["host_firewall_changes_allowed"])
        self.assertFalse(content["auth_files_read_allowed"])
        self.assertFalse(content["keychain_read_allowed"])
        self.assertFalse(content["environment_value_dump_allowed"])


if __name__ == "__main__":
    unittest.main()
