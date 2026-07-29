import json
import unittest

from tools.phase_1d_a3_policy_schema_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA3PolicySchemaValidatorTests(unittest.TestCase):
    def test_a3_evidence_validates_implemented_pure_policy_schema(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertIn("tools/pankster_runtime_security/policy_schema.py", result["implemented_files"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A4_ENVIRONMENT_SANITIZER_IMPLEMENTATION")

    def test_a3_policy_contract_contains_required_and_forbidden_fields(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["policy_schema_contract"]

        self.assertIn("profile_id", contract["required_fields"])
        self.assertIn("model_allowlist", contract["required_fields"])
        self.assertIn("credential_reference_allowlist", contract["required_fields"])
        self.assertIn("authorization_header", contract["forbidden_fields"])
        self.assertIn("root_credential_pool", contract["forbidden_fields"])
        self.assertTrue(contract["result_is_secret_free"])

    def test_a3_purity_contract_blocks_side_effects(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        purity = evidence["decision_content"]["purity_contract"]

        for value in purity.values():
            self.assertFalse(value)
        self.assertIn("reads_auth_json", purity)
        self.assertIn("reads_keychain", purity)
        self.assertIn("network_calls", purity)
        self.assertIn("sandbox_launch", purity)

    def test_a3_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_policy_schema_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)

    def test_a3_fail_closed_cases_cover_schema_denials(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        cases = evidence["decision_content"]["fail_closed_cases"]

        for case in ("missing_required_field", "disabled_profile", "forbidden_secret_field_present", "grant_ttl_exceeds_900", "invalid_budget_field"):
            self.assertIn(case, cases)


if __name__ == "__main__":
    unittest.main()
