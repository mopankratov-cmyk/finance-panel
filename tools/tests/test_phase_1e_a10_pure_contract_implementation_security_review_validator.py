import json
import unittest

from tools.phase_1e_a10_pure_contract_implementation_security_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA10PureContractImplementationSecurityReviewValidatorTests(unittest.TestCase):
    def test_1e_a10_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_RUNTIME_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["implementation_performed"])
        self.assertFalse(result["runtime_integration_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a10_reviewed_files_are_exact_contract_allowlist(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(len(paths), 12)
        self.assertIn("tools/pankster_runtime_security/credential_broker_contracts.py", paths)
        self.assertIn("tools/pankster_runtime_security/model_broker_contracts.py", paths)
        self.assertIn("tools/pankster_runtime_security/secret_scan.py", paths)
        self.assertTrue(all(path.startswith("tools/") for path in paths))

    def test_1e_a10_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_process_env_reads"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_provider_sdks"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1e_a10_findings_cover_credential_model_runtime_and_rollback_controls(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["credential_grants_are_references_only"])
        self.assertTrue(findings["root_auth_fallback_denied"])
        self.assertTrue(findings["model_allowlist_budget_replay_enforced_before_provider_boundary"])
        self.assertTrue(findings["runtime_child_environment_sanitized_with_no_proxy_preservation"])
        self.assertTrue(findings["rollback_disables_new_grants_without_gateway_change"])

    def test_1e_a10_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["targeted_contract_tests"]["tests"], 31)
        self.assertEqual(tests["targeted_1e_a10_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 500)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A11_RUNTIME_INTEGRATION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
