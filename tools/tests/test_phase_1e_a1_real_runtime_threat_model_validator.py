import json
import unittest

from tools.phase_1e_a1_real_runtime_threat_model_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA1RealRuntimeThreatModelValidatorTests(unittest.TestCase):
    def test_1e_a1_evidence_validates_threat_model(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A2_CREDENTIAL_BROKER_DETAILED_SPEC")

    def test_1e_a1_protected_assets_include_credentials_root_auth_and_evidence(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        assets = evidence["decision_content"]["protected_assets"]

        self.assertIn("owner-scoped provider credentials", assets)
        self.assertIn("root auth store and credential pools", assets)
        self.assertIn("Evidence Packs and logs", assets)

    def test_1e_a1_threats_cover_credentials_oauth_replay_and_lifecycle(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        threat_names = [item["name"] for item in evidence["decision_content"]["threats"]]

        self.assertIn("credential_exfiltration_via_environment_or_child_process", threat_names)
        self.assertIn("oauth_refresh_materializes_profile_or_root_credentials", threat_names)
        self.assertIn("grant_replay_or_cross_attempt_use", threat_names)
        self.assertIn("retry_reclaim_restart_scope_expansion", threat_names)

    def test_1e_a1_security_requirements_are_all_true(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        requirements = evidence["decision_content"]["security_requirements"]

        self.assertTrue(requirements)
        for value in requirements.values():
            self.assertTrue(value)

    def test_1e_a1_runtime_execution_remains_unapproved(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        content = evidence["decision_content"]

        self.assertFalse(content["sandbox_execution_approved"])
        self.assertFalse(content["subprocess_launch_approved"])
        self.assertFalse(content["provider_api_calls_approved"])
        self.assertFalse(content["model_api_calls_approved"])
        self.assertFalse(content["oauth_refresh_approved"])


if __name__ == "__main__":
    unittest.main()
