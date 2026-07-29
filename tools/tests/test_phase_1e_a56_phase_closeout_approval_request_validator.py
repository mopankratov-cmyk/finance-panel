import hashlib
import json
import unittest

from tools.phase_1e_a56_phase_closeout_approval_request_validator import (
    DEFAULT_EVIDENCE,
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    validate_evidence,
)


class Phase1EA56PhaseCloseoutApprovalRequestValidatorTests(unittest.TestCase):
    def test_1e_a56_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a56_approval_command_hash_is_exact(self):
        self.assertEqual(hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest(), EXPECTED_APPROVAL_SHA)

    def test_1e_a56_scope_allows_only_future_closeout_package(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["phase_1e_closeout_package_allowed"])
        self.assertTrue(scope["unit_tests_allowed"])
        self.assertFalse(scope["profile_runtime_readiness_gate_allowed"])
        self.assertFalse(scope["profile_runtime_local_precheck_execution_allowed"])
        self.assertFalse(scope["profile_start_allowed"])
        self.assertFalse(scope["provider_api_calls_allowed"])
        self.assertFalse(scope["real_credentials_allowed"])

    def test_1e_a56_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["decision_content"]["future_file_scope_allowlist"],
            [
                "docs/program/PHASE_1E_CLOSEOUT_PACKAGE.md",
                "security/evidence/phase-1e-closeout/phase-1e-closeout-package.json",
                "tools/phase_1e_closeout_package_validator.py",
                "tools/tests/test_phase_1e_closeout_package_validator.py",
            ],
        )

    def test_1e_a56_records_source_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(
            content["source_evidence"]["phase_1e_a55_verdict"],
            "READY_FOR_PHASE_1E_CLOSEOUT_APPROVAL_REQUEST_NOT_RUNTIME",
        )
        self.assertEqual(content["test_results"]["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(content["next_gate"], "PHASE_1E_A57_PHASE_CLOSEOUT_PACKAGE_AFTER_OWNER_APPROVAL")


if __name__ == "__main__":
    unittest.main()
