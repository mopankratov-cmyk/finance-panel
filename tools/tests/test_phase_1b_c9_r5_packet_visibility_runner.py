import json
import unittest

from tools.phase_1b_c9_r5_packet_visibility_runner import (
    CAPTURE_FILTER,
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_RECORD_SHA,
    _parse_tcpdump_summary,
    preflight,
    print_admin_command,
)


class Phase1BC9R5PacketVisibilityRunnerTests(unittest.TestCase):
    def test_c9_r5_preflight_passes_without_execution(self):
        result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertEqual(result["target_guest_ipv4"], "192.168.5.15")
        self.assertEqual(result["candidate_host_interface"], "utun4")
        self.assertFalse(result["packet_visibility_probe_executed"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["raw_packet_output_persistence_allowed"])

    def test_c9_r5_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertTrue(record["packet_visibility_probe_allowed"])
        self.assertTrue(record["packet_capture_allowed"])
        self.assertTrue(record["guest_traffic_generation_allowed"])
        self.assertFalse(record["automatic_privileged_execution_allowed"])
        self.assertFalse(record["pfctl_execution_allowed"])
        self.assertFalse(record["host_firewall_changes_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])

    def test_c9_r5_print_admin_command_keeps_pfctl_blocked(self):
        result = print_admin_command(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertIn("/usr/sbin/tcpdump", result["admin_command"])
        self.assertIn(CAPTURE_FILTER, result["admin_command"])
        self.assertNotIn("pfctl", result["admin_command"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])

    def test_tcpdump_summary_detects_pre_nat_source_without_persisting_raw(self):
        raw = (
            "1700000000.0 IP 192.168.5.15.50123 > 1.1.1.1.443: tcp 0\\n"
            "1700000000.1 IP 1.1.1.1.443 > 192.168.5.15.50123: tcp 0\\n"
        )
        summary = _parse_tcpdump_summary(raw)
        self.assertFalse(summary["raw_output_persisted"])
        self.assertTrue(summary["target_ipv4_observed"])
        self.assertEqual(summary["source_target_packet_count"], 1)
        self.assertEqual(summary["destination_target_packet_count"], 1)
        self.assertTrue(summary["pre_nat_guest_source_observed"])
        self.assertFalse(summary["post_nat_only_observed"])


if __name__ == "__main__":
    unittest.main()
