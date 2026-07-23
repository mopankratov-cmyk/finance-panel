import json
import unittest

from tools.phase_1e_a6_implementation_scope_lock_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA6ImplementationScopeLockValidatorTests(unittest.TestCase):
    def test_1e_a6_evidence_validates_scope_lock(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A7_INDEPENDENT_SECURITY_REVIEW_BEFORE_CODE")

    def test_1e_a6_allowlist_contains_only_contract_modules_and_tests(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        allowlist = evidence["decision_content"]["future_code_allowlist"]

        self.assertIn("tools/pankster_runtime_security/credential_broker_contracts.py", allowlist)
        self.assertIn("tools/pankster_runtime_security/model_broker_contracts.py", allowlist)
        self.assertIn("tools/tests/test_pankster_runtime_security_secret_scan.py", allowlist)
        self.assertTrue(all(path.startswith("tools/") for path in allowlist))

    def test_1e_a6_forbidden_scope_blocks_app_lib_deps_env_gateway_and_agent(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        forbidden = evidence["decision_content"]["forbidden_file_scope"]

        for item in ("app/", "lib/", "package.json", ".env*", "gateway.py", "agent/conversation_loop.py"):
            self.assertIn(item, forbidden)

    def test_1e_a6_constraints_forbid_runtime_side_effects_and_credentials(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        constraints = evidence["decision_content"]["future_code_constraints"]

        self.assertTrue(constraints["no_runtime_side_effects"])
        self.assertTrue(constraints["no_auth_json_or_keychain_reads"])
        self.assertTrue(constraints["no_network_clients"])
        self.assertTrue(constraints["no_subprocess_launch"])
        self.assertTrue(constraints["no_sandbox_launch"])

    def test_1e_a6_separate_approval_required_for_risky_expansion(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        approvals = evidence["decision_content"]["separate_approval_required_for"]

        self.assertIn("any provider SDK use", approvals)
        self.assertIn("any sandbox or subprocess launch", approvals)
        self.assertIn("any real credential read or OAuth refresh", approvals)
        self.assertIn("any production deployment", approvals)


if __name__ == "__main__":
    unittest.main()
