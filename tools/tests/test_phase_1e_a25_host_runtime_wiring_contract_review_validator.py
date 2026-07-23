import json
import unittest

from tools.phase_1e_a25_host_runtime_wiring_contract_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA25HostRuntimeWiringContractReviewValidatorTests(unittest.TestCase):
    def test_1e_a25_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_GATEWAY_BINDING_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["host_runtime_wiring_contract_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a25_reviewed_files_are_exact_a24_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(
            paths,
            [
                "tools/pankster_runtime_security/host_runtime_wiring_contracts.py",
                "tools/tests/test_pankster_runtime_security_host_runtime_wiring_contracts.py",
            ],
        )

    def test_1e_a25_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["disabled_by_default"])
        self.assertTrue(findings["no_process_env_reads"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1e_a25_findings_cover_wiring_manifest_and_revalidation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["wiring_manifest_secret_free"])
        self.assertTrue(findings["wiring_identity_capability_validation_present"])
        self.assertTrue(findings["gateway_core_dependency_and_runtime_launch_flags_denied"])
        self.assertTrue(findings["provider_model_and_credential_materialization_flags_denied"])
        self.assertTrue(findings["expected_profile_backend_policy_rollback_revalidated"])
        self.assertTrue(findings["execution_fail_closed_reasons_propagated"])

    def test_1e_a25_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["targeted_host_runtime_wiring_contract_tests"]["tests"], 6)
        self.assertEqual(tests["targeted_1e_a25_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 580)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A26_GATEWAY_BINDING_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
