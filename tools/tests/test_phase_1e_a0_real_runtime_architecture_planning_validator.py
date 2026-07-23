import json
import unittest

from tools.phase_1e_a0_real_runtime_architecture_planning_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA0RealRuntimeArchitecturePlanningValidatorTests(unittest.TestCase):
    def test_1e_a0_evidence_validates_planning_scope(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A1_REAL_RUNTIME_THREAT_MODEL")

    def test_1e_a0_includes_required_broker_architecture_components(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        components = evidence["decision_content"]["architecture_components"]

        for component in ("host-side credential broker", "host-side model broker", "runtime adapter boundary", "audit sink"):
            self.assertIn(component, components)

    def test_1e_a0_keeps_all_runtime_execution_scope_unapproved(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertFalse(content["sandbox_execution_approved"])
        self.assertFalse(content["subprocess_launch_approved"])
        self.assertFalse(content["provider_api_calls_approved"])
        self.assertFalse(content["model_api_calls_approved"])
        self.assertFalse(content["gateway_changes_approved"])

    def test_1e_a0_required_invariants_cover_credentials_and_children(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        invariants = evidence["decision_content"]["required_invariants"]

        self.assertTrue(invariants["root_auth_fallback_disabled_for_named_profiles"])
        self.assertTrue(invariants["root_credential_pool_materialization_forbidden"])
        self.assertTrue(invariants["terminal_mcp_delegation_children_receive_sanitized_environment"])
        self.assertTrue(invariants["no_proxy_preserved_in_sanitized_environment"])

    def test_1e_a0_forbidden_scope_blocks_code_runtime_credentials_and_deps(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        forbidden = evidence["decision_content"]["forbidden_in_phase_1e_a0"]

        for item in ("implementation code", "sandbox or subprocess launch", "provider/model API call", "real credential read", "dependency or lockfile change"):
            self.assertIn(item, forbidden)


if __name__ == "__main__":
    unittest.main()
