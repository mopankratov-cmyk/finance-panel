import json
import unittest

from tools.phase_1e_a2_credential_broker_detailed_spec_validator import DEFAULT_EVIDENCE, validate_evidence


class Phase1EA2CredentialBrokerDetailedSpecValidatorTests(unittest.TestCase):
    def test_1e_a2_evidence_validates_credential_broker_spec(self):
        result = validate_evidence()

        self.assertEqual(result["result"], "PASS")
        self.assertFalse(result["deployment_approved"])
        self.assertFalse(result["implementation_approved"])
        self.assertFalse(result["production_approved"])
        self.assertEqual(result["next_gate"], "PHASE_1E_A3_MODEL_BROKER_DETAILED_SPEC")

    def test_1e_a2_contract_keeps_credentials_host_only_and_grants_non_secret(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        contract = evidence["decision_content"]["credential_broker_contract"]

        self.assertTrue(contract["credential_values_host_only"])
        self.assertTrue(contract["profile_receives_only_grant_references"])
        self.assertTrue(contract["grant_reference_is_not_bearer_secret"])
        self.assertTrue(contract["root_auth_fallback_disabled_for_named_profiles"])
        self.assertTrue(contract["root_credential_pool_materialization_forbidden"])

    def test_1e_a2_schemas_require_owner_attempt_runtime_and_audit_fields(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        credential_fields = evidence["decision_content"]["credential_reference_schema_required_fields"]
        grant_fields = evidence["decision_content"]["grant_schema_required_fields"]

        self.assertIn("owner_principal_id", credential_fields)
        self.assertIn("attempt_id", grant_fields)
        self.assertIn("runtime_identity_hash", grant_fields)
        self.assertIn("audit_event_id", grant_fields)

    def test_1e_a2_oauth_refresh_contract_is_owner_only_and_worker_forbidden(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        refresh = evidence["decision_content"]["oauth_refresh_future_contract"]

        self.assertTrue(refresh["owner_only"])
        self.assertTrue(refresh["compare_and_swap_required"])
        self.assertTrue(refresh["worker_refresh_forbidden"])
        self.assertTrue(refresh["profile_store_secret_write_forbidden"])

    def test_1e_a2_denied_paths_cover_children_root_and_oauth(self):
        evidence = json.loads(DEFAULT_EVIDENCE.read_text(encoding="utf-8"))
        denied = evidence["decision_content"]["denied_paths"]

        self.assertIn("terminal child secret inheritance", denied)
        self.assertIn("MCP child secret inheritance", denied)
        self.assertIn("root auth fallback for named profile", denied)
        self.assertIn("OAuth refresh from worker", denied)


if __name__ == "__main__":
    unittest.main()
