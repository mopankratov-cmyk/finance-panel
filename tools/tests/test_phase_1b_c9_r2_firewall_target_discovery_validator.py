import unittest

from tools.phase_1b_c9_r2_firewall_target_discovery_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    owner_command_hash,
    validate_contract,
)


class Phase1BC9R2FirewallTargetDiscoveryValidatorTests(unittest.TestCase):
    def test_c9_r2_contract_validates_without_starting_vm_or_pf(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertFalse(result["target_discovery_execution_authorized"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])

    def test_c9_r2_contract_keeps_profile_and_credential_gates_closed(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertFalse(result["production_profiles_allowed"])
        self.assertFalse(result["real_credentials_allowed"])

    def test_c9_r2_owner_command_hash_is_exact(self):
        self.assertEqual(
            owner_command_hash("p1b-20260722-limapftargetc9r2", EXPECTED_CONTRACT_SHA),
            "eb0a90090b72a85b6f76c5d17c59c4a0953e4528d239c24b19396dd08622782d",
        )


if __name__ == "__main__":
    unittest.main()
