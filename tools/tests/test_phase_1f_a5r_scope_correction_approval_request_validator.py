import hashlib
import json
import unittest

from tools.phase_1f_a5r_scope_correction_approval_request_validator import (
    DEFAULT_EVIDENCE,
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    validate_evidence,
)


class Phase1FA5RScopeCorrectionApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a5r_evidence_validates_scope_correction_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1f_a5r_approval_command_hash_is_exact(self):
        self.assertEqual(hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest(), EXPECTED_APPROVAL_SHA)

    def test_1f_a5r_records_a5_governance_conflict_and_no_candidate_commit(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        outcome = evidence["decision_content"]["a5_attempt_outcome"]

        self.assertFalse(outcome["candidate_committed"])
        self.assertFalse(outcome["candidate_push_performed"])
        self.assertTrue(outcome["candidate_scope_was_a4_allowlist_only"])
        self.assertTrue(outcome["full_suite_restored_after_candidate_removal"])
        self.assertEqual(outcome["targeted_candidate_tests_passed"], 17)
        self.assertIn("Phase 1E review validators pin SHA-256 hashes", outcome["governance_conflict"])

    def test_1f_a5r_future_file_scope_uses_versioned_phase_1f_modules_only(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["decision_content"]["future_file_scope_allowlist"],
            [
                "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
                "tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py",
            ],
        )
        self.assertFalse(evidence["decision_content"]["approval_scope"]["phase_1e_hash_pinned_files_changes_allowed"])

    def test_1f_a5r_scope_keeps_runtime_credentials_gateway_and_providers_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["implementation_code_allowed"])
        self.assertTrue(scope["versioned_phase_1f_modules_allowed"])
        self.assertFalse(scope["profile_runtime_execution_allowed"])
        self.assertFalse(scope["profile_start_allowed"])
        self.assertFalse(scope["provider_api_calls_allowed"])
        self.assertFalse(scope["real_credentials_allowed"])
        self.assertFalse(scope["gateway_py_changes_allowed"])
        self.assertFalse(scope["web_server_py_changes_allowed"])

    def test_1f_a5r_records_tests_source_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(content["source_evidence"]["phase_1f_a4_status"], "PHASE_1F_A4_IMPLEMENTATION_APPROVAL_REQUEST_COMPLETE_NO_IMPLEMENTATION")
        self.assertEqual(content["test_results"]["pre_correction_full_tools_unittest_discover_after_candidate_removal"]["tests"], 775)
        self.assertEqual(content["test_results"]["targeted_approval_request_validator_tests"]["tests"], 6)
        self.assertEqual(content["test_results"]["full_tools_unittest_discover"]["tests"], 781)
        self.assertEqual(content["next_gate"], "PHASE_1F_A6_VERSIONED_PURE_CONTRACT_IMPLEMENTATION_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
