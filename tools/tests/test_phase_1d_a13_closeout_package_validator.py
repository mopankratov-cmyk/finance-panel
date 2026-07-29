import json
import unittest

from tools.phase_1d_a13_closeout_package_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1DA13CloseoutPackageValidatorTests(unittest.TestCase):
    def test_a13_evidence_validates_closeout_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "PHASE_1D_SYNTHETIC_BASELINE_COMPLETE_NOT_PRODUCTION_READY")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_a13_security_invariants_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        invariants = evidence["decision_content"]["security_invariants"]

        self.assertTrue(invariants)
        for value in invariants.values():
            self.assertTrue(value)

    def test_a13_blocks_real_runtime_until_phase_1e(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        blocked = evidence["decision_content"]["blocked_until_phase_1e"]

        for item in ("real sandbox runtime integration", "real host-side credential broker", "real provider/model broker calls", "production deployment"):
            self.assertIn(item, blocked)

    def test_a13_commit_chain_records_a0_through_a12(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        chain = evidence["decision_content"]["commit_chain"]

        for gate in ("a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"):
            self.assertIn(gate, chain)
            self.assertTrue(chain[gate])

    def test_a13_records_next_phase_planning_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A0_REAL_RUNTIME_ARCHITECTURE_PLANNING")


if __name__ == "__main__":
    unittest.main()
