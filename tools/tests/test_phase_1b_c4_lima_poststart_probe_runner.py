import json
import unittest

from tools.phase_1b_c4_lima_poststart_probe_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_RECORD_SHA,
    preflight,
)


class Phase1BC4LimaPoststartProbeRunnerTests(unittest.TestCase):
    def test_c4_preflight_passes_without_probes(self):
        result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["probe_count"], 8)
        self.assertFalse(result["network_probes_allowed"])
        self.assertFalse(result["preserve_host_env_allowed"])
        self.assertFalse(result["probes_executed"])

    def test_c4_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertFalse(record["network_probes_allowed"])
        self.assertFalse(record["preserve_host_env_allowed"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])


if __name__ == "__main__":
    unittest.main()
