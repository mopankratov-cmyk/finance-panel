import json
import unittest

from tools.phase_1c_a2_threat_model_validator import DEFAULT_THREAT_MODEL, validate_threat_model


class Phase1CA2ThreatModelValidatorTests(unittest.TestCase):
    def test_a2_threat_model_validates_without_runtime_approval(self):
        result = validate_threat_model()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "REMOTE_SANDBOX_REQUIRES_HOST_SIDE_CREDENTIAL_AND_MODEL_BROKERS")
        self.assertFalse(result["runtime_approved"])
        self.assertFalse(result["implementation_ready"])
        self.assertEqual(result["next_gate"], "PHASE_1C_A3_ISOLATION_PROOF_CONTRACT")

    def test_a2_blocks_raw_credentials_in_sandbox(self):
        model = json.loads(DEFAULT_THREAT_MODEL.read_text(encoding="utf-8"))
        boundaries = model["required_boundaries"]

        self.assertFalse(boundaries["sandbox_receives_root_auth"])
        self.assertFalse(boundaries["sandbox_receives_non_profile_service_credentials"])
        self.assertFalse(boundaries["sandbox_receives_raw_host_environment"])
        self.assertTrue(boundaries["host_side_model_broker_preferred"])
        self.assertTrue(boundaries["host_side_capability_broker_required_for_external_services"])

    def test_a2_requires_policy_before_worker_code(self):
        model = json.loads(DEFAULT_THREAT_MODEL.read_text(encoding="utf-8"))
        boundaries = model["required_boundaries"]

        self.assertTrue(boundaries["deny_by_default_network_before_worker_code"])
        self.assertTrue(boundaries["sanitized_environment_inherited_by_children"])
        self.assertTrue(boundaries["fail_closed_before_user_code_on_policy_failure"])
        self.assertTrue(boundaries["sanitized_evidence_only"])

    def test_a2_forbids_side_effects(self):
        model = json.loads(DEFAULT_THREAT_MODEL.read_text(encoding="utf-8"))

        for field, value in model["forbidden_in_a2"].items():
            self.assertFalse(value, field)


if __name__ == "__main__":
    unittest.main()
