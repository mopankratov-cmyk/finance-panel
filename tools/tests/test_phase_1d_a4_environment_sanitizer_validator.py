import json
import unittest

from tools.phase_1d_a4_environment_sanitizer_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA4EnvironmentSanitizerValidatorTests(unittest.TestCase):
    def test_a4_evidence_validates_implemented_pure_environment_sanitizer(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertIn("tools/pankster_runtime_security/environment_sanitizer.py", result["implemented_files"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A5_FAKE_GRANT_REGISTRY_AND_BROKER_IMPLEMENTATION")

    def test_a4_sanitizer_contract_preserves_proxy_and_denies_sensitive_patterns(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["sanitizer_contract"]

        self.assertIn("NO_PROXY", contract["preserve_keys"])
        self.assertIn("no_proxy", contract["preserve_keys"])
        self.assertIn("PANKSTER_GRANT_IDS", contract["pankster_runtime_keys"])
        self.assertIn("TELEGRAM_*", contract["mandatory_denylist"])
        self.assertIn("E2B_API_KEY", contract["mandatory_denylist"])
        self.assertTrue(contract["denylist_precedence_over_allowlist"])

    def test_a4_purity_contract_blocks_side_effects(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        purity = evidence["decision_content"]["purity_contract"]

        for value in purity.values():
            self.assertFalse(value)
        self.assertIn("reads_process_environment", purity)
        self.assertIn("reads_auth_json", purity)
        self.assertIn("network_calls", purity)
        self.assertIn("sandbox_launch", purity)

    def test_a4_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_environment_sanitizer_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)

    def test_a4_fail_closed_cases_cover_secret_value_paths(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        cases = evidence["decision_content"]["fail_closed_cases"]

        for case in ("denylisted_key_removed", "unknown_key_ignored", "non_string_value_ignored", "secret_value_not_reported", "case_insensitive_sensitive_key_denial"):
            self.assertIn(case, cases)


if __name__ == "__main__":
    unittest.main()
