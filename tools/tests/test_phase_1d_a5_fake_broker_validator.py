import json
import unittest

from tools.phase_1d_a5_fake_broker_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA5FakeBrokerValidatorTests(unittest.TestCase):
    def test_a5_evidence_validates_implemented_fake_grant_registry_and_broker(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertIn("tools/pankster_runtime_security/fake_grants.py", result["implemented_files"])
        self.assertIn("tools/pankster_runtime_security/fake_model_broker.py", result["implemented_files"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A6_RUNTIME_ADAPTER_INTERFACE_STUBS")

    def test_a5_fake_grant_contract_enforces_identity_budget_and_replay(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["fake_grant_contract"]

        self.assertEqual(contract["grant_id_prefix"], "grant_opaque_")
        self.assertFalse(contract["grant_reference_secret"])
        self.assertTrue(contract["attempt_binding_required"])
        self.assertTrue(contract["runtime_identity_binding_required"])
        self.assertTrue(contract["model_allowlist_enforced"])
        self.assertTrue(contract["operation_allowlist_enforced"])
        self.assertTrue(contract["budget_enforced_before_response"])
        self.assertTrue(contract["replay_detection"])

    def test_a5_fake_broker_contract_blocks_provider_network_and_credentials(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["fake_broker_contract"]

        self.assertFalse(contract["provider_network_calls"])
        self.assertFalse(contract["provider_sdks_used"])
        self.assertFalse(contract["real_credentials_used"])
        self.assertTrue(contract["returns_synthetic_payload_only"])
        self.assertTrue(contract["denial_response_has_no_payload"])

    def test_a5_purity_contract_blocks_side_effects(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        purity = evidence["decision_content"]["purity_contract"]

        for value in purity.values():
            self.assertFalse(value)
        self.assertIn("reads_process_environment", purity)
        self.assertIn("reads_auth_json", purity)
        self.assertIn("network_calls", purity)
        self.assertIn("sandbox_launch", purity)

    def test_a5_records_targeted_test_pass_and_fail_closed_cases(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]["targeted_fake_grant_and_broker_tests"]

        self.assertEqual(tests["result"], "PASS")
        self.assertEqual(tests["tests"], 10)
        for case in ("grant_replay_detected", "budget_exceeded", "model_not_allowlisted", "attempt_mismatch"):
            self.assertIn(case, content["fail_closed_cases"])


if __name__ == "__main__":
    unittest.main()
