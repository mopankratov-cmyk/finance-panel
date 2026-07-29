import hashlib
import json
import unittest

from tools.phase_1b_c16_reclaim_only_closeout_validator import (
    DEFAULT_CONTRACT,
    EXPECTED_CONTRACT_SHA,
    EXPECTED_OWNER_COMMAND_HASH,
    owner_command,
    validate_contract,
)

PROJECT_ROOT = DEFAULT_CONTRACT.parents[2]
DEFAULT_APPROVAL_RECORD = PROJECT_ROOT / "docs/program/PHASE_1B_C16_RECLAIM_ONLY_CLOSEOUT_APPROVAL_RECORD.json"
DEFAULT_EXECUTION_SUMMARY = PROJECT_ROOT / "security/evidence/phase-1b-c16/reclaim-only-closeout-execution-summary.json"
EXPECTED_APPROVAL_RECORD_SHA = "fa7434cbe2e1ce4b1a9719959e5750782be483c75da839a857aa9b9833ad5e70"


class Phase1BC16ReclaimOnlyCloseoutValidatorTests(unittest.TestCase):
    def test_c16_reclaim_contract_validates_without_execution(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["contract_content_sha256"], EXPECTED_CONTRACT_SHA)
        self.assertEqual(result["owner_command_hash"], EXPECTED_OWNER_COMMAND_HASH)
        self.assertTrue(result["manual_owner_approval_required"])
        self.assertFalse(result["reclaim_execution_performed"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])
        self.assertFalse(result["production_profiles_allowed"])
        self.assertFalse(result["real_credentials_allowed"])

    def test_c16_reclaim_contract_is_strictly_scoped(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        content = contract["contract_content"]
        target_map = {target["instance_name"]: target["lima_home"] for target in content["targets"]}

        self.assertEqual(
            target_map,
            {
                "pc3": "/Users/maksimpankratov/.local/pankster/runtime/lc3",
                "pc9r2": "/Users/maksimpankratov/.local/pankster/runtime/lc9r2",
            },
        )
        self.assertFalse(content["wildcard_delete_allowed"])
        self.assertFalse(content["broad_path_delete_allowed"])
        self.assertFalse(content["rm_rf_allowed"])
        self.assertFalse(content["default_lima_home_allowed"])
        for command in content["exact_commands"].values():
            self.assertNotIn("*", command)
            self.assertNotIn("rm -rf", command)
            self.assertNotIn("LIMA_HOME=/Users/maksimpankratov/.lima", command)

    def test_c16_reclaim_owner_command_hash_is_stable(self):
        command = owner_command(EXPECTED_CONTRACT_SHA)
        self.assertEqual(hashlib.sha256(command.encode("utf-8")).hexdigest(), EXPECTED_OWNER_COMMAND_HASH)
        self.assertEqual(
            command,
            "APPROVE_PHASE_1B_RECLAIM_ONLY_CLOSEOUT:p1b-20260722-reclaimonlyc16:315f08ddf8dd4220127b33e880074c49e012941bdc1365aad7db424a5daa473d",
        )

    def test_c16_reclaim_approval_record_preserves_hard_gates(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))

        self.assertEqual(record["record_sha256"], EXPECTED_APPROVAL_RECORD_SHA)
        self.assertTrue(record["reclaim_execution_allowed"])
        self.assertFalse(record["wildcard_delete_allowed"])
        self.assertFalse(record["broad_path_delete_allowed"])
        self.assertFalse(record["rm_rf_allowed"])
        self.assertFalse(record["default_lima_home_allowed"])
        self.assertFalse(record["pfctl_execution_allowed"])
        self.assertFalse(record["host_firewall_changes_allowed"])
        self.assertFalse(record["gateway_changes_allowed"])
        self.assertFalse(record["production_profiles_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["canary_allowed"])

    def test_c16_reclaim_execution_summary_is_scoped_and_complete(self):
        summary = json.loads(DEFAULT_EXECUTION_SUMMARY.read_text(encoding="utf-8"))

        self.assertEqual(summary["result"], "PASS")
        self.assertFalse(summary["sanitization"]["raw_limactl_inventory_output_included"])
        self.assertFalse(summary["sanitization"]["raw_process_logs_included"])
        self.assertTrue(summary["before_inventory"]["pc3"]["target_confirmed"])
        self.assertTrue(summary["before_inventory"]["pc9r2"]["target_confirmed"])
        self.assertEqual(summary["delete_execution"]["pc3"]["returncode"], 0)
        self.assertEqual(summary["delete_execution"]["pc9r2"]["returncode"], 0)
        self.assertTrue(summary["after_inventory"]["pc3_lima_home"]["target_absent"])
        self.assertTrue(summary["after_inventory"]["pc9r2_lima_home"]["target_absent"])
        self.assertEqual(summary["reclaim_result"]["phase_1b_synthetic_lima_vms_remaining_in_scoped_homes"], 0)
        self.assertFalse(summary["hard_gates"]["pfctl_executed"])
        self.assertFalse(summary["hard_gates"]["host_firewall_changed"])
        self.assertFalse(summary["hard_gates"]["gateway_changed"])
        self.assertFalse(summary["hard_gates"]["production_profiles_started"])
        self.assertFalse(summary["hard_gates"]["real_credentials_used"])
        self.assertFalse(summary["hard_gates"]["canary_started"])
        self.assertFalse(summary["hard_gates"]["evidence_deleted"])


if __name__ == "__main__":
    unittest.main()
