import json
import unittest

from tools.phase_1c_a1_backend_capability_validator import DEFAULT_MATRIX, validate_matrix


class Phase1CA1BackendCapabilityValidatorTests(unittest.TestCase):
    def test_a1_matrix_validates_without_approving_backend(self):
        result = validate_matrix()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["recommendation"], "SHORTLIST_REMOTE_SANDBOXES_FOR_A2_THREAT_MODEL")
        self.assertEqual(result["shortlist"], ["modal_sandbox", "e2b_sandbox"])
        self.assertFalse(result["backend_approved"])
        self.assertFalse(result["implementation_ready"])
        self.assertEqual(result["next_gate"], "PHASE_1C_A2_PROFILE_RUNTIME_THREAT_MODEL")

    def test_a1_shortlists_only_remote_sandbox_candidates(self):
        matrix = json.loads(DEFAULT_MATRIX.read_text(encoding="utf-8"))
        candidates = matrix["candidate_matrix"]

        self.assertEqual(candidates["modal_sandbox"]["disposition"], "SHORTLIST_REMOTE_SANDBOX_A2")
        self.assertTrue(candidates["modal_sandbox"]["native_egress_controls_found"])
        self.assertEqual(candidates["e2b_sandbox"]["disposition"], "SHORTLIST_REMOTE_SANDBOX_A2")
        self.assertTrue(candidates["e2b_sandbox"]["native_egress_controls_found"])
        self.assertEqual(candidates["lima"]["disposition"], "REJECTED_BY_PHASE_1B_FOR_STANDALONE_PROFILE_RUNTIME")

    def test_a1_does_not_mark_any_candidate_implementation_ready(self):
        matrix = json.loads(DEFAULT_MATRIX.read_text(encoding="utf-8"))

        for name, payload in matrix["candidate_matrix"].items():
            self.assertFalse(payload["profile_runtime_approved"], name)
            self.assertFalse(payload["implementation_ready"], name)

    def test_a1_forbids_side_effects(self):
        matrix = json.loads(DEFAULT_MATRIX.read_text(encoding="utf-8"))

        for field, value in matrix["forbidden_in_a1"].items():
            self.assertFalse(value, field)
        for field, value in matrix["source_policy"].items():
            if field == "official_sources_only":
                self.assertTrue(value)
            else:
                self.assertFalse(value, field)


if __name__ == "__main__":
    unittest.main()
