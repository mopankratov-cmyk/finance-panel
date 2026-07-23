import json
import unittest

from tools.phase_1f_a16_versioned_host_adapter_implementation_security_review_validator import DEFAULT_EVIDENCE, EXPECTED_REVIEWED_FILES, validate_evidence


class Phase1FA16VersionedHostAdapterImplementationSecurityReviewValidatorTests(unittest.TestCase):
    def test_1f_a16_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_PHASE_1F_A17_VERSIONED_HOST_RUNTIME_EXECUTION_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["implementation_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_1f_a16_reviewed_files_are_exact_a14_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(paths, [path for path, _sha in EXPECTED_REVIEWED_FILES])

    def test_1f_a16_findings_cover_versioned_host_adapter_contract_guards(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["changed_files_match_a14_allowlist"])
        self.assertTrue(findings["phase_1e_hash_pinned_host_adapter_files_preserved"])
        self.assertTrue(findings["versioned_host_adapter_module_added"])
        self.assertTrue(findings["versioned_host_adapter_tests_added"])
        self.assertTrue(findings["pure_contract_layer_only"])
        self.assertTrue(findings["disabled_by_default_present"])
        self.assertTrue(findings["implementation_scope_guard_present"])
        self.assertTrue(findings["host_manifest_secret_free"])

    def test_1f_a16_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_credential_materialization"])
        self.assertTrue(findings["no_gateway_web_server_profile_worker_or_hermes_core_changes"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_provider_or_model_api_calls"])
        self.assertTrue(findings["no_runtime_binding"])
        self.assertTrue(findings["no_runtime_execution"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1f_a16_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1f_a14_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_versioned_host_adapter_contract_tests"]["tests"], 8)
        self.assertEqual(tests["targeted_1f_a16_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 845)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A17_VERSIONED_HOST_RUNTIME_EXECUTION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
