import json
import unittest

from tools.phase_1b_c9_r5_packet_visibility_validator import (
    APPROVAL_PREFIX,
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    owner_command_hash,
    validate_contract,
)


class Phase1BC9R5PacketVisibilityValidatorTests(unittest.TestCase):
    def test_c9_r5_contract_validates_as_owner_review_only(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertEqual(result["target_guest_ipv4"], "192.168.5.15")
        self.assertEqual(result["candidate_host_interface"], "utun4")
        self.assertFalse(result["packet_visibility_probe_authorized"])
        self.assertTrue(result["packet_capture_approval_required"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["production_profiles_allowed"])
        self.assertFalse(result["real_credentials_allowed"])

    def test_c9_r5_contract_keeps_firewall_blocked_and_capture_scoped(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        self.assertEqual(contract["content_sha256"], EXPECTED_CONTRACT_SHA)
        self.assertTrue(content["packet_capture_allowed"])
        self.assertTrue(content["guest_traffic_generation_allowed"])
        self.assertEqual(content["packet_capture_interface"], "utun4")
        self.assertEqual(content["packet_capture_filter"], "host 192.168.5.15 and tcp and port 443")
        self.assertEqual(content["packet_capture_max_packets"], 8)
        self.assertEqual(content["packet_capture_max_seconds"], 12)
        self.assertFalse(content["pfctl_execution_allowed"])
        self.assertFalse(content["host_firewall_changes_allowed"])
        self.assertFalse(content["packet_capture_raw_output_persistence_allowed"])
        self.assertFalse(content["packet_capture_payload_persistence_allowed"])
        self.assertFalse(content["runner_after_approval"]["automatic_privileged_execution_allowed"])
        self.assertIn("/sbin/pfctl", content["tool_denylist_even_after_approval"])

    def test_c9_r5_owner_command_hash_is_stable(self):
        self.assertEqual(APPROVAL_PREFIX, "APPROVE_SYNTHETIC_LIMA_PACKET_VISIBILITY_PROBE")
        self.assertEqual(
            owner_command_hash("p1b-20260722-limapktc9r5", EXPECTED_CONTRACT_SHA),
            "dda685c043396aef54cc560aee15dfc2859c6d47c41cbaee74ed5a5bc24543f6",
        )


if __name__ == "__main__":
    unittest.main()
