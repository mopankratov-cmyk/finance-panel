import hashlib
import json
import unittest

from tools.phase_1f_a1_runtime_integration_owner_approval_request_validator import (
    DEFAULT_EVIDENCE,
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    validate_evidence,
)


class Phase1FA1RuntimeIntegrationOwnerApprovalRequestValidatorTests(unittest.TestCase):
    def test_1f_a1_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertFalse(result["implementation_performed"])
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1f_a1_approval_command_hash_is_exact(self):
        self.assertEqual(hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest(), EXPECTED_APPROVAL_SHA)

    def test_1f_a1_scope_allows_only_future_scope_lock(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["phase_1f_a2_scope_lock_allowed"])
        self.assertTrue(scope["unit_tests_allowed"])
        self.assertFalse(scope["runtime_integration_implementation_allowed"])
        self.assertFalse(scope["profile_runtime_execution_allowed"])
        self.assertFalse(scope["profile_start_allowed"])
        self.assertFalse(scope["provider_api_calls_allowed"])
        self.assertFalse(scope["real_credentials_allowed"])

    def test_1f_a1_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["decision_content"]["future_file_scope_allowlist"],
            [
                "docs/program/PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK.md",
                "security/evidence/phase-1f-a2/runtime-implementation-scope-lock.json",
                "tools/phase_1f_a2_runtime_implementation_scope_lock_validator.py",
                "tools/tests/test_phase_1f_a2_runtime_implementation_scope_lock_validator.py",
            ],
        )

    def test_1f_a1_records_source_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(
            content["source_evidence"]["phase_1f_a0_verdict"],
            "PHASE_1F_PLANNING_ONLY_NOT_READY_FOR_RUNTIME_OR_PRODUCTION",
        )
        self.assertEqual(content["test_results"]["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(content["next_gate"], "PHASE_1F_A2_RUNTIME_IMPLEMENTATION_SCOPE_LOCK_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
