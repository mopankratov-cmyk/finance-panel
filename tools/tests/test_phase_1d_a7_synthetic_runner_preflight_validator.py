import json
import unittest

from tools.phase_1d_a7_synthetic_runner_preflight_validator import DEFAULT_EVIDENCE, EXPECTED_CONTRACT, validate_evidence


class Phase1DA7SyntheticRunnerPreflightValidatorTests(unittest.TestCase):
    def test_a7_evidence_validates_preflight_contract(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["execution_approval_issued"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A8_IMPLEMENTATION_SECURITY_REVIEW")

    def test_a7_contract_file_is_no_execution_contract(self):
        contract = json.loads(EXPECTED_CONTRACT.read_text(encoding="utf-8"))

        self.assertEqual(contract["contract_state"], "READY_FOR_SECURITY_REVIEW_NO_EXECUTION_APPROVAL")
        self.assertFalse(contract["contract_content"]["execution_approval_issued"])
        self.assertTrue(contract["contract_content"]["future_execution_requires_new_owner_approval"])
        self.assertEqual(contract["contract_content"]["contract_mode"], "preflight_contract_only")

    def test_a7_scope_forbids_runtime_provider_credentials_gateway_and_profiles(self):
        contract = json.loads(EXPECTED_CONTRACT.read_text(encoding="utf-8"))
        scope = contract["contract_content"]["preflight_scope"]

        for field in (
            "production_profiles_allowed",
            "real_credentials_allowed",
            "provider_api_calls_allowed",
            "model_api_calls_allowed",
            "sandbox_creation_allowed",
            "subprocess_launch_allowed",
            "gateway_changes_allowed",
            "profile_start_allowed",
        ):
            self.assertFalse(scope[field])
        self.assertTrue(scope["synthetic_only"])

    def test_a7_evidence_invariants_require_post_a8_owner_approval(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        invariants = evidence["decision_content"]["preflight_contract_invariants"]

        self.assertTrue(invariants["preflight_contract_only"])
        self.assertFalse(invariants["execution_allowed_by_this_gate"])
        self.assertFalse(invariants["sandbox_creation_allowed_by_this_gate"])
        self.assertTrue(invariants["future_execution_requires_post_a8_owner_approval"])

    def test_a7_records_targeted_test_pass(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        tests = evidence["decision_content"]["test_results"]["targeted_preflight_contract_validator_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 5)


if __name__ == "__main__":
    unittest.main()
