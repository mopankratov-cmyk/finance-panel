import json
import unittest
from unittest.mock import patch

from tools.phase_1b_c9_r2_firewall_target_discovery_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_RECORD_SHA,
    preflight,
)


class Phase1BC9R2FirewallTargetDiscoveryRunnerTests(unittest.TestCase):
    def test_c9_r2_preflight_passes_without_execution(self):
        with patch(
            "tools.phase_1b_c9_r2_firewall_target_discovery_runner."
            "_validate_no_existing_runtime_state"
        ):
            result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["target_instance"], "pc9r2")
        self.assertFalse(result["target_discovery_executed"])
        self.assertTrue(result["new_vm_start_allowed"])
        self.assertFalse(result["pfctl_execution_allowed"])
        self.assertFalse(result["host_firewall_changes_allowed"])

    def test_c9_r2_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertTrue(record["target_discovery_execution_allowed"])
        self.assertTrue(record["new_vm_start_allowed"])
        self.assertFalse(record["pfctl_execution_allowed"])
        self.assertFalse(record["host_firewall_changes_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])


if __name__ == "__main__":
    unittest.main()
