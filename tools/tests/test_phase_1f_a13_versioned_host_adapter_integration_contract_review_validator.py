import json
import unittest

from tools.phase_1f_a13_versioned_host_adapter_integration_contract_review_validator import DEFAULT_EVIDENCE, EXPECTED_REVIEWED_FILES, validate_evidence


class Phase1FA13VersionedHostAdapterIntegrationContractReviewValidatorTests(unittest.TestCase):
    def test_1f_a13_evidence_validates_fail_closed_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "REVISION_REQUIRED_BEFORE_PHASE_1F_HOST_RUNTIME_EXECUTION_VERSIONED_HOST_ADAPTER_LAYER_MISSING")
        self.assertTrue(result["host_adapter_contract_review_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_1f_a13_reviewed_files_are_exact_base_host_adapter_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(paths, [path for path, _sha in EXPECTED_REVIEWED_FILES])

    def test_1f_a13_findings_record_missing_versioned_layer(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["base_host_adapter_contract_reviewed"])
        self.assertTrue(findings["base_host_adapter_contract_disabled_by_default"])
        self.assertTrue(findings["base_host_manifest_secret_free"])
        self.assertTrue(findings["phase_1f_versioned_host_adapter_module_absent"])
        self.assertTrue(findings["phase_1f_versioned_host_adapter_tests_absent"])

    def test_1f_a13_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_credential_materialization"])
        self.assertTrue(findings["no_gateway_web_server_profile_worker_or_hermes_core_changes"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_provider_or_model_api_calls"])
        self.assertTrue(findings["no_runtime_integration"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1f_a13_records_required_changes_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(len(content["required_changes"]), 2)
        self.assertEqual(tests["phase_1f_a12_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_base_host_adapter_contract_tests"]["tests"], 6)
        self.assertEqual(tests["targeted_1f_a13_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 827)
        self.assertEqual(content["next_gate"], "PHASE_1F_A14_VERSIONED_HOST_ADAPTER_IMPLEMENTATION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
