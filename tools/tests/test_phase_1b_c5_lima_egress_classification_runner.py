import json
import unittest

from tools.phase_1b_c5_lima_egress_classification_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_RECORD_SHA,
    preflight,
)


class Phase1BC5LimaEgressClassificationRunnerTests(unittest.TestCase):
    def test_c5_preflight_passes_without_executing_network_probes(self):
        result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["probe_count"], 4)
        self.assertTrue(result["network_probes_allowed"])
        self.assertFalse(result["http_payloads_allowed"])
        self.assertFalse(result["preserve_host_env_allowed"])
        self.assertFalse(result["guest_writes_allowed"])
        self.assertFalse(result["probes_executed"])

    def test_c5_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertTrue(record["network_probes_allowed"])
        self.assertFalse(record["http_payloads_allowed"])
        self.assertFalse(record["preserve_host_env_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])

    def test_c5_contract_does_not_authorize_http_or_package_tools(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        serialized = json.dumps(contract["contract_content"]["allowed_probe_commands"], sort_keys=True)
        for forbidden in ("curl", "wget", "apt", "apk", "dnf", "yum", "brew", "http://", "https://"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
