import json
import unittest

from tools.phase_1c_a8_production_readiness_validator import DEFAULT_CLOSEOUT, validate_closeout


class Phase1CA8ProductionReadinessValidatorTests(unittest.TestCase):
    def test_a8_closeout_validates_not_production_approved(self):
        result = validate_closeout()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "SYNTHETIC_E2B_ISOLATION_PROOF_PASSED_PRODUCTION_NOT_APPROVED")
        self.assertEqual(result["final_status"], "READY_FOR_ARCHITECTURE_DESIGN_NEXT_NOT_PRODUCTION_DEPLOYMENT")
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "A9_HOST_SIDE_MODEL_AND_CREDENTIAL_BROKER_SPEC")

    def test_a8_records_synthetic_proof_basis(self):
        closeout = json.loads(DEFAULT_CLOSEOUT.read_text(encoding="utf-8"))
        basis = closeout["decision_content"]["basis"]

        self.assertEqual(basis["a7_execution_result"], "PASS")
        self.assertTrue(basis["sandbox_created"])
        self.assertTrue(basis["sandbox_destroyed"])
        self.assertTrue(basis["allow_internet_access_false_proved"])
        self.assertTrue(basis["application_level_outbound_denial_observed"])
        self.assertFalse(basis["provider_credential_value_printed"])

    def test_a8_keeps_production_capabilities_blocked(self):
        closeout = json.loads(DEFAULT_CLOSEOUT.read_text(encoding="utf-8"))
        blocked = closeout["decision_content"]["not_approved_capabilities"]

        self.assertTrue(blocked["production_profile_execution"])
        self.assertTrue(blocked["real_model_credentials_in_sandbox"])
        self.assertTrue(blocked["root_auth_json_fallback"])
        self.assertTrue(blocked["gateway_runtime_change"])
        self.assertTrue(blocked["oauth_refresh_or_credential_write"])

    def test_a8_requires_next_architecture_gates(self):
        closeout = json.loads(DEFAULT_CLOSEOUT.read_text(encoding="utf-8"))
        gates = closeout["decision_content"]["required_next_gates"]

        self.assertIn("A9_HOST_SIDE_MODEL_AND_CREDENTIAL_BROKER_SPEC", gates)
        self.assertIn("A10_RUNTIME_ADAPTER_DESIGN_REVIEW", gates)
        self.assertIn("A14_FINAL_IMPLEMENTATION_READINESS_REVIEW", gates)

    def test_a8_confirms_runtime_not_changed(self):
        closeout = json.loads(DEFAULT_CLOSEOUT.read_text(encoding="utf-8"))
        runtime = closeout["decision_content"]["read_only_runtime_confirmation"]

        self.assertFalse(runtime["gateway_restarted"])
        self.assertFalse(runtime["profiles_started"])
        self.assertFalse(runtime["canary_started"])
        self.assertFalse(runtime["production_credentials_used"])
        self.assertFalse(runtime["hermes_core_modified"])


if __name__ == "__main__":
    unittest.main()
