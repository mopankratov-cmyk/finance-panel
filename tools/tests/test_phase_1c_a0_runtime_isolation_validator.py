import json
import unittest

from tools.phase_1c_a0_runtime_isolation_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1CA0RuntimeIsolationValidatorTests(unittest.TestCase):
    def test_a0_evidence_validates_as_not_implementation_ready(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["phase_result"], "START_NEW_ARCHITECTURE_PATH_NOT_IMPLEMENTATION_READY")
        self.assertFalse(result["implementation_ready"])
        self.assertEqual(result["lima_vz_standalone_backend"], "REJECTED_FOR_PROFILE_RUNTIME")
        self.assertEqual(result["next_gate"], "PHASE_1C_A1_BACKEND_CAPABILITY_MATRIX")

    def test_a0_hard_requirements_preserve_credential_isolation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        requirements = evidence["hard_requirements"]

        self.assertTrue(requirements["separate_profile_auth_store_required"])
        self.assertFalse(requirements["root_auth_fallback_for_non_default_profiles_allowed"])
        self.assertFalse(requirements["root_credential_pool_materialization_allowed"])
        self.assertTrue(requirements["sanitized_subprocess_environment_required"])
        self.assertTrue(requirements["fail_closed_required"])

    def test_a0_forbids_runtime_side_effects(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        for field, value in evidence["forbidden_in_a0"].items():
            self.assertFalse(value, field)

    def test_a0_candidate_classes_reject_failed_assumptions(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        candidates = evidence["candidate_classes"]

        self.assertEqual(candidates["lima_vz_standalone_backend"], "REJECTED_FOR_PROFILE_RUNTIME")
        self.assertEqual(candidates["macos_container_runtime_with_opaque_nat"], "REJECT_UNLESS_NATIVE_POLICY_PROVEN")
        self.assertEqual(candidates["remote_sandbox_with_provider_side_network_policy"], "RESEARCH_REQUIRED")
        self.assertEqual(candidates["local_vm_with_explicit_virtual_network_policy"], "RESEARCH_REQUIRED")


if __name__ == "__main__":
    unittest.main()
