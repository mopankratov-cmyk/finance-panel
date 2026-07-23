import hashlib
import json
import unittest

from tools.phase_1e_a50_profile_runtime_local_precheck_execution_approval_request_validator import (
    DEFAULT_EVIDENCE,
    EXPECTED_APPROVAL,
    EXPECTED_APPROVAL_SHA,
    validate_evidence,
)


class Phase1EA50ProfileRuntimeLocalPrecheckExecutionApprovalRequestValidatorTests(unittest.TestCase):
    def test_1e_a50_evidence_validates_approval_request(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["approval_command_sha256"], EXPECTED_APPROVAL_SHA)
        self.assertFalse(result["integration_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a50_approval_command_hash_is_exact(self):
        self.assertEqual(hashlib.sha256(EXPECTED_APPROVAL.encode()).hexdigest(), EXPECTED_APPROVAL_SHA)

    def test_1e_a50_scope_allows_only_future_disabled_execution_contract(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        scope = evidence["decision_content"]["approval_scope"]

        self.assertTrue(scope["disabled_by_default_profile_runtime_local_precheck_execution_contract_allowed"])
        self.assertTrue(scope["tools_runtime_security_files_allowed"])
        self.assertTrue(scope["unit_tests_allowed"])
        self.assertFalse(scope["profile_runtime_local_precheck_execution_allowed"])
        self.assertFalse(scope["profile_runtime_local_precheck_allowed"])
        self.assertFalse(scope["profile_start_allowed"])
        self.assertFalse(scope["provider_api_calls_allowed"])
        self.assertFalse(scope["real_credentials_allowed"])

    def test_1e_a50_future_file_scope_is_narrow(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))

        self.assertEqual(
            evidence["decision_content"]["future_file_scope_allowlist"],
            [
                "tools/pankster_runtime_security/profile_runtime_local_precheck_execution_contracts.py",
                "tools/tests/test_pankster_runtime_security_profile_runtime_local_precheck_execution_contracts.py",
            ],
        )

    def test_1e_a50_records_source_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertEqual(
            content["source_evidence"]["phase_1e_a49_verdict"],
            "READY_FOR_PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_APPROVAL_REQUEST_NOT_RUNTIME",
        )
        self.assertEqual(content["test_results"]["targeted_approval_request_validator_tests"]["tests"], 5)
        self.assertEqual(
            content["next_gate"],
            "PHASE_1E_A51_PROFILE_RUNTIME_LOCAL_PRECHECK_EXECUTION_CONTRACT_AFTER_OWNER_APPROVAL",
        )


if __name__ == "__main__":
    unittest.main()
