import json
import unittest

from tools.phase_1c_a14_final_readiness_validator import DEFAULT_REVIEW, validate_review


class Phase1CA14FinalReadinessValidatorTests(unittest.TestCase):
    def test_a14_review_closes_phase_1c_without_production_or_deployment_approval(self):
        result = validate_review()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_CONTROLLED_IMPLEMENTATION_PHASE_NOT_DEPLOYMENT")
        self.assertTrue(result["phase_1c_complete"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1D_CONTROLLED_IMPLEMENTATION_PLANNING")

    def test_a14_reviews_all_prior_gates(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        gates = review["decision_content"]["reviewed_gates"]

        self.assertEqual(len(gates), 14)
        self.assertIn("A0_RUNTIME_ISOLATION_BACKEND_RESELECTION", gates)
        self.assertIn("A13_ROLLBACK_AND_OPERATOR_RUNBOOK", gates)

    def test_allowed_next_scope_is_feature_flagged_and_fake_broker_only(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        allowed = review["decision_content"]["implementation_scope_allowed_next"]

        self.assertIn("create_feature_flagged_runtime_adapter_interfaces", allowed)
        self.assertIn("create_fake_host_side_model_broker_for_tests", allowed)
        self.assertIn("create_fake_credential_broker_grant_registry_for_tests", allowed)

    def test_forbidden_next_scope_blocks_production_credentials_gateway_and_deploy(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        forbidden = review["decision_content"]["implementation_scope_forbidden_next"]

        for item in ("enable_production_profiles", "start_gateway_or_canary", "call_real_model_or_provider_apis", "read_root_auth_json_or_keychain", "perform_oauth_refresh", "change_default_gateway_behavior", "deploy_to_production"):
            self.assertIn(item, forbidden)

    def test_closeout_records_residual_risks_and_hard_production_blockers(self):
        review = json.loads(DEFAULT_REVIEW.read_text(encoding="utf-8"))
        content = review["decision_content"]

        self.assertIn("architecture_not_yet_implemented", content["residual_risks"])
        self.assertIn("no_real_runtime_adapter", content["hard_blockers_to_production"])
        self.assertEqual(content["phase_1c_closeout"]["production_approval"], "NOT_APPROVED")
        self.assertEqual(content["phase_1c_closeout"]["deployment_approval"], "NOT_APPROVED")


if __name__ == "__main__":
    unittest.main()
