import json
import unittest

from tools.phase_1b_c9_host_firewall_research_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    owner_command_hash,
    validate_contract,
)


class Phase1BC9HostFirewallResearchValidatorTests(unittest.TestCase):
    def test_c9_contract_validates_without_firewall_execution(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["host_firewall_execution_authorized"])
        self.assertFalse(result["host_firewall_changes_performed"])
        self.assertTrue(result["future_experiment_requires_owner_approval"])
        self.assertTrue(result["future_experiment_requires_new_disposable_vm"])

    def test_c9_contract_keeps_profile_and_gateway_gates_closed(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertFalse(result["production_profiles_allowed"])
        self.assertFalse(result["real_credentials_allowed"])
        self.assertFalse(result["gateway_changes_allowed"])
        self.assertFalse(result["canary_allowed"])

    def test_c9_contract_requires_future_approval_for_pf_execution(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        self.assertEqual(contract["content_sha256"], EXPECTED_CONTRACT_SHA)
        self.assertFalse(content["host_firewall_changes_allowed_by_preparation"])
        self.assertTrue(content["host_firewall_changes_require_future_approval"])
        self.assertFalse(content["existing_pc3_reuse_for_production_candidate_allowed"])
        self.assertEqual(content["pf_anchor_name"], "com.apple/pankster_phase1b_c9")
        self.assertEqual(
            owner_command_hash(content["approval_id"], EXPECTED_CONTRACT_SHA),
            "e7ca5d2bd588c5d50d0596e97f9192da0d08f732290d8ee88f9510734ff9bb09",
        )


if __name__ == "__main__":
    unittest.main()
