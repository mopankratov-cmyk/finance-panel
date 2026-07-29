import json
import unittest

from tools.phase_1b_c9_r4_host_network_observability_validator import (
    APPROVAL_PREFIX,
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    owner_command_hash,
    validate_contract,
)


class Phase1BC9R4HostNetworkObservabilityValidatorTests(unittest.TestCase):
    def test_c9_r4_contract_validates_as_owner_review_only(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertEqual(result["target_guest_ipv4"], "192.168.5.15")
        self.assertFalse(result["host_network_observability_authorized"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["packet_capture_allowed"])
        self.assertFalse(result["production_profiles_allowed"])
        self.assertFalse(result["real_credentials_allowed"])

    def test_c9_r4_contract_forbids_privileged_and_network_probe_tools(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        self.assertEqual(contract["content_sha256"], EXPECTED_CONTRACT_SHA)
        self.assertEqual(content["tool_allowlist"], ["/sbin/ifconfig", "/usr/sbin/netstat", "/sbin/route"])
        self.assertIn("/sbin/pfctl", content["tool_denylist"])
        self.assertIn("/usr/sbin/tcpdump", content["tool_denylist"])
        self.assertIn("/usr/bin/sudo", content["tool_denylist"])
        self.assertNotIn("/sbin/pfctl", content["tool_allowlist"])
        self.assertNotIn("/usr/sbin/tcpdump", content["tool_allowlist"])
        self.assertFalse(content["pfctl_execution_allowed"])
        self.assertFalse(content["packet_capture_allowed"])
        self.assertFalse(content["guest_traffic_generation_allowed"])

    def test_c9_r4_owner_command_hash_is_stable(self):
        self.assertEqual(APPROVAL_PREFIX, "APPROVE_SYNTHETIC_LIMA_HOST_NETWORK_OBSERVABILITY")
        self.assertEqual(
            owner_command_hash("p1b-20260722-limaobsc9r4", EXPECTED_CONTRACT_SHA),
            "a55ad60c41129171f3fba67d5fbf1ed3e9ff08dcc6962c2bd030692563843350",
        )


if __name__ == "__main__":
    unittest.main()
