import json
import unittest

from tools.phase_1d_a1_scope_contract_validator import DEFAULT_CONTRACT, validate_contract


class Phase1DA1ScopeContractValidatorTests(unittest.TestCase):
    def test_a1_contract_validates_without_code_or_runtime_approval(self):
        result = validate_contract()

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["decision"], "PHASE_1D_EXACT_SCOPE_LOCKED_FOR_FUTURE_PURE_IMPLEMENTATION_GATES")
        self.assertFalse(result["implementation_code_approved"])
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "1D-A2_FEATURE_FLAG_AND_CONFIG_SCAFFOLD_SPEC")

    def test_branch_contract_blocks_main_force_and_dirty_gate(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        branch = contract["decision_content"]["branch_contract"]

        self.assertEqual(branch["current_branch"], "phase/1c-runtime-isolation-architecture")
        self.assertFalse(branch["main_push_allowed"])
        self.assertFalse(branch["force_push_allowed"])
        self.assertFalse(branch["dirty_worktree_allowed_before_gate"])
        self.assertTrue(branch["commit_each_gate"])

    def test_future_code_scope_is_exact_tools_package_and_tests(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        scope = contract["decision_content"]["future_code_scope_allowed"]

        self.assertEqual(scope["new_package_root"], "tools/pankster_runtime_security/")
        self.assertIn("tools/pankster_runtime_security/policy_schema.py", scope["package_files"])
        self.assertIn("tools/pankster_runtime_security/environment_sanitizer.py", scope["package_files"])
        self.assertIn("tools/pankster_runtime_security/fake_model_broker.py", scope["package_files"])
        self.assertIn("tools/tests/test_pankster_runtime_security_environment_sanitizer.py", scope["test_files"])

    def test_forbidden_scope_blocks_app_lib_deps_env_gateway_and_hermes_core(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        forbidden = contract["decision_content"]["forbidden_planning_scope"]

        for item in ("app/", "components/", "lib/", "package.json", ".env", ".env.local", "gateway.py", "web_server.py", "agent/conversation_loop.py", "Hermes core runtime files outside this repository"):
            self.assertIn(item, forbidden)

    def test_module_permissions_block_side_effects_network_credentials_and_sandbox(self):
        contract = json.loads(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        matrix = contract["decision_content"]["module_permission_matrix"]

        for module in ("policy_schema", "environment_sanitizer", "fake_grants_and_broker"):
            self.assertFalse(matrix[module]["runtime_side_effects_allowed"])
            self.assertFalse(matrix[module]["network_allowed"])
            self.assertFalse(matrix[module]["credential_reads_allowed"])
        self.assertFalse(matrix["runtime_adapter_contracts"]["sandbox_launch_allowed"])
        self.assertFalse(matrix["runtime_adapter_contracts"]["gateway_integration_allowed"])


if __name__ == "__main__":
    unittest.main()
