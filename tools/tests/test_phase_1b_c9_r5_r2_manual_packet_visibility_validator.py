import json
import unittest

from tools.phase_1b_c9_r5_r2_manual_packet_visibility_validator import (
    APPROVAL_PREFIX,
    DEFAULT_CONTRACT,
    EXPECTED_CAPTURE_COMMAND_SHA,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_TRIGGER_COMMAND_SHA,
    owner_command_hash,
    validate_contract,
)

DEFAULT_APPROVAL_RECORD = (
    DEFAULT_CONTRACT.parent / "PHASE_1B_C9_R5_R2_MANUAL_PACKET_VISIBILITY_PROCEDURE_APPROVAL_RECORD.json"
)
DEFAULT_OPERATOR_RESULT = (
    DEFAULT_CONTRACT.parents[2]
    / "security/evidence/phase-1b-c9-r5-r2/manual-packet-visibility-operator-result.json"
)
DEFAULT_C9_R6_BLOCK = (
    DEFAULT_CONTRACT.parents[2]
    / "security/evidence/phase-1b-c9-r6/target-uniqueness-or-firewall-execution-block.json"
)
EXPECTED_RECORD_SHA = "4e497efbbd9f78707ce7606b472d453d2284ecf9024520ab9ffc2ed059f1053e"


class Phase1BC9R5R2ManualPacketVisibilityValidatorTests(unittest.TestCase):
    def test_c9_r5_r2_contract_validates_as_manual_operator_gate(self):
        result = validate_contract(DEFAULT_CONTRACT)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertEqual(result["target_guest_ipv4"], "192.168.5.15")
        self.assertEqual(result["candidate_host_interface"], "utun4")
        self.assertTrue(result["manual_operator_action_required"])
        self.assertFalse(result["codex_automatic_privileged_execution_allowed"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["raw_packet_output_persistence_allowed"])

    def test_c9_r5_r2_contract_forbids_raw_and_firewall_mutation(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        self.assertEqual(contract["content_sha256"], EXPECTED_CONTRACT_SHA)
        self.assertEqual(content["packet_capture_command_sha256"], EXPECTED_CAPTURE_COMMAND_SHA)
        self.assertEqual(content["synthetic_guest_trigger_command_sha256"], EXPECTED_TRIGGER_COMMAND_SHA)
        self.assertTrue(content["operator_must_not_paste_raw_packet_lines"])
        self.assertFalse(content["operator_return_format"]["raw_packet_output_persisted"])
        self.assertFalse(content["codex_automatic_privileged_execution_allowed"])
        self.assertFalse(content["pfctl_execution_allowed"])
        self.assertFalse(content["host_firewall_changes_allowed"])
        self.assertFalse(content["packet_capture_raw_output_persistence_allowed"])
        self.assertIn("/sbin/pfctl", content["tool_denylist_even_after_approval"])

    def test_c9_r5_r2_owner_command_hash_is_stable(self):
        self.assertEqual(APPROVAL_PREFIX, "APPROVE_SYNTHETIC_LIMA_MANUAL_PACKET_VISIBILITY_PROCEDURE")
        self.assertEqual(
            owner_command_hash("p1b-20260722-limapktr2c9r5", EXPECTED_CONTRACT_SHA),
            "4b24070d3e9d0a313b077b18d0c5be002dde4b1ef80974ebabc47a52318ed281",
        )

    def test_c9_r5_r2_approval_record_is_manual_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["manual_operator_action_allowed"])
        self.assertFalse(record["codex_automatic_privileged_execution_allowed"])
        self.assertTrue(record["operator_must_return_sanitized_counts_only"])
        self.assertTrue(record["operator_must_not_paste_raw_packet_lines"])
        self.assertFalse(record["pfctl_execution_allowed"])
        self.assertFalse(record["host_firewall_changes_allowed"])
        self.assertFalse(record["packet_capture_raw_output_persistence_allowed"])

    def test_c9_r5_r2_operator_result_does_not_authorize_firewall(self):
        result = json.loads(DEFAULT_OPERATOR_RESULT.read_text(encoding="utf-8"))
        operator_return = result["operator_return"]
        self.assertTrue(operator_return["packet_capture_performed"])
        self.assertFalse(operator_return["target_ipv4_observed"])
        self.assertEqual(operator_return["source_target_packet_count"], 0)
        self.assertEqual(operator_return["destination_target_packet_count"], 0)
        self.assertFalse(operator_return["pre_nat_guest_source_observed"])
        self.assertEqual(operator_return["tcpdump_packets_captured"], 0)
        self.assertEqual(operator_return["tcpdump_packets_received_by_filter"], 4482)
        self.assertFalse(result["interpretation"]["pf_visibility_proof_available"])
        self.assertFalse(result["interpretation"]["firewall_execution_contract_ready"])
        self.assertFalse(result["hard_gates"]["pfctl_execution_allowed"])
        self.assertFalse(result["hard_gates"]["host_firewall_changes_allowed"])

    def test_c9_r6_blocks_firewall_execution_fail_closed(self):
        block = json.loads(DEFAULT_C9_R6_BLOCK.read_text(encoding="utf-8"))
        self.assertEqual(block["result"], "FIREWALL_EXECUTION_BLOCKED")
        self.assertTrue(block["r6_reasoning"]["fail_closed"])
        self.assertFalse(block["r6_reasoning"]["pre_nat_guest_source_visibility_proven"])
        self.assertFalse(block["r6_reasoning"]["firewall_execution_contract_ready"])
        self.assertTrue(block["blocked_actions"]["pfctl_execution"])
        self.assertTrue(block["blocked_actions"]["host_firewall_mutation"])


if __name__ == "__main__":
    unittest.main()
