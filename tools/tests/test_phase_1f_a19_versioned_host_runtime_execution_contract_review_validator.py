import json
import unittest

from tools.phase_1f_a19_versioned_host_runtime_execution_contract_review_validator import DEFAULT_EVIDENCE, EXPECTED_REVIEWED_FILES, validate_evidence


class Phase1FA19VersionedHostRuntimeExecutionContractReviewValidatorTests(unittest.TestCase):
    def test_1f_a19_evidence_validates_review_verdict(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertTrue(result["implementation_performed"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["verdict"], "READY_FOR_PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST_NOT_RUNTIME")

    def test_1f_a19_reviewed_files_are_exact_a17_scope(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        reviewed = evidence["decision_content"]["reviewed_files"]

        self.assertEqual([item["path"] for item in reviewed], [path for path, _sha in EXPECTED_REVIEWED_FILES])
        self.assertEqual([item["sha256"] for item in reviewed], [sha for _path, sha in EXPECTED_REVIEWED_FILES])

    def test_1f_a19_findings_cover_versioned_host_runtime_contract_guards(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["a17_exact_owner_approval_verified"])
        self.assertTrue(findings["changed_files_match_a17_allowlist"])
        self.assertTrue(findings["phase_1e_hash_pinned_host_runtime_files_preserved"])
        self.assertTrue(findings["implementation_scope_guard_present"])
        self.assertTrue(findings["host_runtime_manifest_secret_scan_present"])
        self.assertTrue(findings["versioned_host_adapter_composition_preserved"])

    def test_1f_a19_findings_keep_runtime_provider_and_credentials_closed(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        findings = evidence["decision_content"]["security_review_findings"]

        self.assertTrue(findings["no_runtime_execution"])
        self.assertTrue(findings["no_runtime_process_start"])
        self.assertTrue(findings["no_runtime_binding"])
        self.assertTrue(findings["no_subprocess_launch"])
        self.assertTrue(findings["no_sandbox_launch"])
        self.assertTrue(findings["no_provider_or_model_api_calls"])
        self.assertTrue(findings["no_credential_materialization"])
        self.assertTrue(findings["no_auth_json_or_keychain_reads"])

    def test_1f_a19_records_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]
        tests = content["test_results"]

        self.assertEqual(tests["phase_1f_a17_validator"]["result"], "PASS")
        self.assertEqual(tests["targeted_versioned_host_runtime_execution_contract_tests"]["tests"], 8)
        self.assertEqual(tests["targeted_1f_a19_validator_tests"]["tests"], 5)
        self.assertEqual(tests["full_tools_unittest_discover"]["tests"], 863)
        self.assertEqual(content["required_changes"], [])
        self.assertEqual(content["next_gate"], "PHASE_1F_A20_VERSIONED_HOST_RUNTIME_WIRING_APPROVAL_REQUEST")


if __name__ == "__main__":
    unittest.main()
