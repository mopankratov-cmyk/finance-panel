import json
import unittest

from tools.phase_1f_a0_runtime_integration_planning_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1FA0RuntimeIntegrationPlanningValidatorTests(unittest.TestCase):
    def test_phase_1f_a0_evidence_validates_planning_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "PHASE_1F_PLANNING_ONLY_NOT_READY_FOR_RUNTIME_OR_PRODUCTION")
        self.assertFalse(result["implementation_allowed_now"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_phase_1f_a0_security_invariants_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        invariants = evidence["decision_content"]["security_invariants"]

        self.assertTrue(invariants)
        for value in invariants.values():
            self.assertTrue(value)

    def test_phase_1f_a0_blocks_real_runtime_without_future_approval(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        blocked = evidence["decision_content"]["blocked_actions_without_future_explicit_owner_approval"]

        for item in (
            "Hermes core integration",
            "real host-side credential broker storage",
            "real provider/model broker calls",
            "profile runtime process launch",
            "production deployment",
        ):
            self.assertIn(item, blocked)

    def test_phase_1f_a0_records_planned_safe_sequence(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        sequence = evidence["decision_content"]["planned_phase_1f_sequence"]

        self.assertIn("A1 owner approval request for exact Phase 1F implementation scope", sequence)
        self.assertIn("A3 independent security review before code", sequence)
        self.assertIn(
            "separate execution approval before any local precheck, sandbox, subprocess, profile, provider, OAuth, or deployment action",
            sequence,
        )

    def test_phase_1f_a0_records_next_owner_approval_request_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
