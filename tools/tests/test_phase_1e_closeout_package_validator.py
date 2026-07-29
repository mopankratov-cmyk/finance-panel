import json
import unittest

from tools.phase_1e_closeout_package_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1ECloseoutPackageValidatorTests(unittest.TestCase):
    def test_phase_1e_closeout_evidence_validates_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "PHASE_1E_CONTRACT_RUNTIME_ARCHITECTURE_COMPLETE_NOT_PRODUCTION_READY")
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_phase_1e_security_invariants_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        invariants = evidence["decision_content"]["security_invariants"]

        self.assertTrue(invariants)
        for value in invariants.values():
            self.assertTrue(value)

    def test_phase_1e_blocks_real_runtime_until_separate_future_phase(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        blocked = evidence["decision_content"]["blocked_until_separate_future_phase"]

        for item in (
            "Hermes core integration",
            "real host-side credential broker storage",
            "real provider/model broker calls",
            "profile runtime process launch",
            "production deployment",
        ):
            self.assertIn(item, blocked)

    def test_phase_1e_commit_chain_records_a0_through_a56_only(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        chain = evidence["decision_content"]["commit_chain"]

        for index in range(57):
            gate = f"a{index}"
            self.assertIn(gate, chain)
            self.assertTrue(chain[gate])
        self.assertNotIn("a57", chain)

    def test_phase_1e_records_next_phase_requires_separate_approval(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_REQUIRES_SEPARATE_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
