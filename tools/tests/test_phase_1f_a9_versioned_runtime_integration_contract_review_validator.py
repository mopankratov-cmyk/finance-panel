import json
import unittest

from tools.phase_1f_a9_versioned_runtime_integration_contract_review_validator import DEFAULT_EVIDENCE, EXPECTED_REVIEWED_FILES, validate_evidence


class Phase1FA9VersionedRuntimeIntegrationContractReviewValidatorTests(unittest.TestCase):
    def test_1f_a9_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["integration_contract_review_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])

    def test_1f_a9_reviewed_files_are_exact_versioned_contract_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(paths, [path for path, _sha in EXPECTED_REVIEWED_FILES])

    def test_1f_a9_findings_keep_runtime_credentials_gateway_and_providers_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_credential_materialization"])
        self.assertTrue(findings["no_gateway_web_server_profile_worker_or_hermes_core_changes"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_provider_or_model_api_calls"])
        self.assertTrue(findings["no_runtime_launch"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])

    def test_1f_a9_findings_cover_a8_approval_and_contract_guards(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["a8_exact_owner_approval_verified"])
        self.assertTrue(findings["a9_artifacts_match_a8_allowlist"])
        self.assertTrue(findings["reviewed_versioned_contract_files_match_a6_allowlist"])
        self.assertTrue(findings["phase_1e_hash_pinned_files_preserved"])
        self.assertTrue(findings["disabled_by_default_present"])
        self.assertTrue(findings["fail_closed_scope_attestation_present"])

    def test_1f_a9_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1f_a8_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_versioned_contract_tests"]["tests"], 11)
        self.assertEqual(tests["targeted_1f_a9_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 807)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A10_VERSIONED_RUNTIME_ADAPTER_BINDING_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
