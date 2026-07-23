import json
import unittest

from tools.phase_1f_a2_runtime_implementation_scope_lock_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1FA2RuntimeImplementationScopeLockValidatorTests(unittest.TestCase):
    def test_1f_a2_evidence_validates_scope_lock(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertFalse(result["runtime_execution_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE")

    def test_1f_a2_allowlist_is_only_two_contract_modules_and_tests(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_code_allowlist_after_separate_a4_owner_approval"]

        self.assertEqual(
            allowlist,
            [
                "tools/pankster_runtime_security/runtime_integration_contracts.py",
                "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
            ],
        )

    def test_1f_a2_forbidden_scope_blocks_runtime_entrypoints_and_deps(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        forbidden = evidence["decision_content"]["forbidden_file_scope"]

        for item in ("app/", "lib/", "package.json", ".env*", "gateway.py", "web_server.py", "agent/conversation_loop.py"):
            self.assertIn(item, forbidden)

    def test_1f_a2_constraints_forbid_side_effects_credentials_and_launches(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        constraints = evidence["decision_content"]["future_code_constraints"]

        self.assertTrue(constraints["independent_security_review_before_code_required"])
        self.assertTrue(constraints["disabled_by_default_required"])
        self.assertTrue(constraints["fail_closed_required"])
        self.assertTrue(constraints["no_runtime_side_effects"])
        self.assertTrue(constraints["no_auth_json_or_keychain_reads"])
        self.assertTrue(constraints["no_credential_materialization"])
        self.assertTrue(constraints["no_network_clients"])
        self.assertTrue(constraints["no_subprocess_launch"])
        self.assertTrue(constraints["no_sandbox_launch"])

    def test_1f_a2_records_approval_source_tests_and_next_gate(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertTrue(content["approval_consumed"]["approval_scope_respected"])
        self.assertEqual(
            content["source_evidence"]["phase_1f_a1_status"],
            "PHASE_1F_A1_RUNTIME_INTEGRATION_OWNER_APPROVAL_REQUEST_COMPLETE_NO_SCOPE_LOCK",
        )
        self.assertEqual(content["test_results"]["targeted_1f_a2_validator_tests"]["tests"], 5)
        self.assertEqual(content["test_results"]["full_tools_unittest_discover"]["tests"], 765)
        self.assertEqual(content["next_gate"], "PHASE_1F_A3_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE")


if __name__ == "__main__":
    unittest.main()
