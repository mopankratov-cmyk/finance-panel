import json
import unittest

from tools.phase_1e_a13_disabled_runtime_integration_contract_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA13DisabledRuntimeIntegrationContractReviewValidatorTests(unittest.TestCase):
    def test_1e_a13_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["integration_contract_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a13_reviewed_files_are_exact_a12_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(
            paths,
            [
                "tools/pankster_runtime_security/runtime_integration_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
            ],
        )

    def test_1e_a13_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["disabled_by_default"])
        self.assertTrue(findings["no_process_env_reads"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1e_a13_findings_cover_child_surfaces_and_revalidation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["child_surfaces_cover_terminal_code_execution_delegate_mcp_background"])
        self.assertTrue(findings["child_environments_are_sanitized"])
        self.assertTrue(findings["no_proxy_preservation_covered"])
        self.assertTrue(findings["broker_and_audit_preconditions_required"])
        self.assertTrue(findings["context_profile_surface_and_grant_refs_revalidated"])

    def test_1e_a13_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["targeted_runtime_integration_contract_tests"]["tests"], 6)
        self.assertEqual(tests["targeted_1e_a13_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 516)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A14_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
