import unittest

from tools.pankster_runtime_security.policy_schema import GRANT_TTL_SECONDS_MAX, validate_profile_policy


def valid_policy():
    return {
        "profile_id": "synthetic-enabled-test-profile",
        "enabled": True,
        "owner_principal_id": "owner:synthetic",
        "policy_version": "policy-v1",
        "runtime_backend": "synthetic",
        "network_policy_id": "deny-all",
        "model_provider_allowlist": ["fake-provider"],
        "model_allowlist": ["fake-model-allowed"],
        "operation_allowlist": ["model.complete"],
        "grant_ttl_seconds_max": GRANT_TTL_SECONDS_MAX,
        "budget": {
            "max_usd_per_attempt": 0,
            "max_tokens_per_attempt": 100,
            "max_requests_per_attempt": 1,
            "max_wall_clock_seconds": 30,
            "max_retries": 0,
        },
        "rate_limits": {"requests_per_minute": 1},
        "credential_reference_allowlist": ["fake-provider-reference-not-secret"],
        "environment_policy_id": "env-policy-v1",
        "artifact_policy_id": "artifact-policy-v1",
        "audit_policy_id": "audit-policy-v1",
        "rollback_policy_id": "rollback-policy-v1",
    }


class PanksterRuntimeSecurityPolicySchemaTests(unittest.TestCase):
    def test_valid_synthetic_policy_is_allowed(self):
        result = validate_profile_policy(valid_policy())

        self.assertTrue(result.allowed)
        self.assertEqual(result.reasons, ())
        self.assertIn("profile_id", result.normalized_keys)

    def test_missing_required_field_denies_without_values(self):
        policy = valid_policy()
        del policy["model_allowlist"]

        result = validate_profile_policy(policy)

        self.assertFalse(result.allowed)
        self.assertIn("MISSING_FIELD:model_allowlist", result.reasons)
        self.assertNotIn("fake-model-allowed", " ".join(result.reasons))

    def test_disabled_profile_denies_launch_by_default(self):
        policy = valid_policy()
        policy["enabled"] = False

        result = validate_profile_policy(policy)

        self.assertFalse(result.allowed)
        self.assertIn("PROFILE_DISABLED", result.reasons)

    def test_forbidden_secret_fields_are_rejected_recursively(self):
        policy = valid_policy()
        policy["nested"] = {"authorization_header": "synthetic-redacted"}

        result = validate_profile_policy(policy)

        self.assertFalse(result.allowed)
        self.assertIn("FORBIDDEN_FIELD:nested.authorization_header", result.reasons)
        self.assertNotIn("synthetic-redacted", " ".join(result.reasons))

    def test_empty_allowlists_ttl_overflow_and_bad_budget_deny(self):
        policy = valid_policy()
        policy["model_provider_allowlist"] = []
        policy["grant_ttl_seconds_max"] = GRANT_TTL_SECONDS_MAX + 1
        policy["budget"]["max_requests_per_attempt"] = -1

        result = validate_profile_policy(policy)

        self.assertFalse(result.allowed)
        self.assertIn("INVALID_ALLOWLIST:model_provider_allowlist", result.reasons)
        self.assertIn("INVALID_GRANT_TTL", result.reasons)
        self.assertIn("INVALID_BUDGET_FIELD:max_requests_per_attempt", result.reasons)


if __name__ == "__main__":
    unittest.main()
