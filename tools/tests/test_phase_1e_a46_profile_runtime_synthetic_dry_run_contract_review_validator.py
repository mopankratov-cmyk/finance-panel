import json
import unittest

from tools.phase_1e_a46_profile_runtime_synthetic_dry_run_contract_review_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA46ProfileRuntimeSyntheticDryRunContractReviewValidatorTests(unittest.TestCase):
    def test_1e_a46_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["verdict"], "READY_FOR_PROFILE_RUNTIME_LOCAL_PRECHECK_APPROVAL_REQUEST_NOT_RUNTIME")
        self.assertTrue(result["profile_runtime_synthetic_dry_run_contract_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])

    def test_1e_a46_reviewed_files_are_exact_a45_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        paths = [item["path"] for item in evidence["decision_content"]["reviewed_files"]]

        self.assertEqual(
            paths,
            [
                "tools/pankster_runtime_security/profile_runtime_synthetic_dry_run_contracts.py",
                "tools/tests/test_pankster_runtime_security_profile_runtime_synthetic_dry_run_contracts.py",
            ],
        )

    def test_1e_a46_findings_keep_runtime_provider_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["disabled_by_default"])
        self.assertTrue(findings["no_process_env_reads"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])
        self.assertTrue(findings["no_network_clients"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])
        self.assertTrue(findings["no_synthetic_dry_run"])
        self.assertTrue(findings["no_oauth_refresh"])

    def test_1e_a46_findings_cover_dry_run_manifest_and_revalidation(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["profile_runtime_synthetic_dry_run_manifest_secret_free"])
        self.assertTrue(findings["profile_runtime_synthetic_dry_run_identity_capability_validation_present"])
        self.assertTrue(findings["profile_runtime_synthetic_dry_run_and_profile_start_flags_denied"])
        self.assertTrue(findings["provider_model_credential_and_oauth_flags_denied"])
        self.assertTrue(findings["expected_profile_backend_policy_rollback_wiring_gateway_worker_activation_execution_invocation_synthetic_revalidated"])
        self.assertTrue(findings["profile_runtime_synthetic_invocation_fail_closed_reasons_propagated"])

    def test_1e_a46_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["targeted_profile_runtime_synthetic_dry_run_contract_tests"]["tests"], 6)
        self.assertEqual(tests["targeted_1e_a46_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 692)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1E_A47_PROFILE_RUNTIME_LOCAL_PRECHECK_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
