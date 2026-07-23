import json
import unittest

from tools.phase_1f_a7_versioned_pure_contract_implementation_security_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1FA7VersionedPureContractImplementationSecurityReviewValidatorTests(unittest.TestCase):
    def test_1f_a7_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_PHASE_1F_A8_VERSIONED_RUNTIME_INTEGRATION_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["implementation_performed"])
        self.assertFalse(result["runtime_integration_approved"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1f_a7_reviewed_files_are_exact_versioned_allowlist(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(
            paths,
            [
                "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
                "tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py",
            ],
        )

    def test_1f_a7_findings_keep_runtime_credentials_gateway_and_providers_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["phase_1e_hash_pinned_files_preserved"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_credential_materialization"])
        self.assertTrue(findings["no_gateway_web_server_profile_worker_or_hermes_core_changes"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_provider_or_model_api_calls"])
        self.assertTrue(findings["no_runtime_launch"])

    def test_1f_a7_findings_cover_disabled_fail_closed_versioned_contracts(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["changed_files_match_a5r_versioned_allowlist"])
        self.assertTrue(findings["versioned_phase_1f_modules_added"])
        self.assertTrue(findings["contract_layer_only"])
        self.assertTrue(findings["disabled_by_default_present"])
        self.assertTrue(findings["fail_closed_scope_attestation_present"])
        self.assertTrue(findings["runtime_binding_composes_existing_disabled_contract_only"])

    def test_1f_a7_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1f_a5r_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_contract_tests"]["tests"], 11)
        self.assertEqual(tests["targeted_1f_a7_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 797)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A8_VERSIONED_RUNTIME_INTEGRATION_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
