import json
import unittest

from tools.phase_1b_c3_lima_runtime_start_runner import (
    DEFAULT_APPROVAL_RECORD,
    DEFAULT_CONTRACT,
    EXPECTED_NETWORK_DECISION,
    EXPECTED_RECORD_SHA,
    RuntimeStartError,
    preflight,
)


class Phase1BC3LimaRuntimeStartRunnerTests(unittest.TestCase):
    def test_c3_preflight_passes_without_start(self):
        try:
            result = preflight(DEFAULT_CONTRACT, DEFAULT_APPROVAL_RECORD)
        except RuntimeStartError as error:
            self.assertEqual(error.reason, "LIMA_HOME_ALREADY_EXISTS")
            return
        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["network_risk_decision"], EXPECTED_NETWORK_DECISION)
        self.assertFalse(result["runtime_start_executed"])
        self.assertFalse(result["guest_image_downloaded"])
        self.assertFalse(result["real_credentials_allowed"])
        self.assertFalse(result["production_profiles_allowed"])

    def test_c3_approval_record_is_exact_and_synthetic_only(self):
        record = json.loads(DEFAULT_APPROVAL_RECORD.read_text(encoding="utf-8"))
        self.assertEqual(record["record_sha256"], EXPECTED_RECORD_SHA)
        self.assertTrue(record["synthetic_only"])
        self.assertFalse(record["real_credentials_allowed"])
        self.assertFalse(record["production_profiles_allowed"])
        self.assertFalse(record["gateway_changes_allowed"])
        self.assertFalse(record["canary_allowed"])
        self.assertEqual(record["network_risk_decision"], EXPECTED_NETWORK_DECISION)


if __name__ == "__main__":
    unittest.main()
