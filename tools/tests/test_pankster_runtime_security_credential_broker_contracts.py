import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.credential_broker_contracts import (
    CredentialGrantRequest,
    CredentialReference,
    OAuthRefreshRequest,
    issue_credential_grant,
    validate_credential_reference,
    validate_oauth_refresh_request,
)


def credential_ref(**overrides):
    values = {
        "credential_ref_id": "cred_ref_openai_primary",
        "owner_principal_id": "owner-1",
        "provider_family": "openai",
        "allowed_profiles": ("dev-director",),
        "allowed_operations": ("model.complete",),
        "rotation_epoch": "rot-1",
        "policy_version": "policy-v1",
        "status": "active",
        "metadata": {"label": "primary"},
    }
    values.update(overrides)
    return CredentialReference(**values)


def grant_request(**overrides):
    values = {
        "profile_id": "dev-director",
        "owner_principal_id": "owner-1",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "policy_version": "policy-v1",
        "purpose": "model-broker-call",
        "provider_family": "openai",
        "model_allowlist": ("gpt-5",),
        "operation_allowlist": ("model.complete",),
        "ttl_seconds": 300,
        "budget_requests": 2,
        "sequence_policy": "single-use-sequence",
    }
    values.update(overrides)
    return CredentialGrantRequest(**values)


class PanksterRuntimeSecurityCredentialBrokerContractTests(unittest.TestCase):
    def test_credential_reference_accepts_metadata_without_secret_values(self):
        result = validate_credential_reference(credential_ref())

        self.assertTrue(result.allowed)
        self.assertEqual(result.reason, "CREDENTIAL_REFERENCE_ACCEPTED")

    def test_credential_reference_rejects_secret_field_metadata(self):
        result = validate_credential_reference(credential_ref(metadata={"api_key": "redacted-fixture"}))

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "CREDENTIAL_REFERENCE_SECRET_FIELD")
        self.assertNotIn("redacted-fixture", str(result))

    def test_issue_grant_returns_opaque_reference_only_after_audit(self):
        result = issue_credential_grant(reference=credential_ref(), request=grant_request(), audit_sink=AuditSinkState(True))

        self.assertTrue(result.allowed)
        self.assertEqual(result.reason, "GRANT_REFERENCE_ISSUED")
        self.assertIsNotNone(result.grant)
        self.assertTrue(result.grant.grant_id.startswith("grant_ref_"))
        self.assertEqual(result.grant.credential_ref_id, "cred_ref_openai_primary")
        self.assertNotIn("api_key", str(result.grant))

    def test_issue_grant_fails_when_audit_unavailable_or_root_fallback_requested(self):
        audit_denied = issue_credential_grant(reference=credential_ref(), request=grant_request(), audit_sink=AuditSinkState(False))
        fallback_denied = issue_credential_grant(
            reference=credential_ref(),
            request=grant_request(),
            audit_sink=AuditSinkState(True),
            root_auth_fallback_enabled=True,
        )
        pool_denied = issue_credential_grant(
            reference=credential_ref(),
            request=grant_request(),
            audit_sink=AuditSinkState(True),
            root_pool_materialization_requested=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(fallback_denied.reason, "ROOT_AUTH_FALLBACK_DISABLED_FOR_NAMED_PROFILE")
        self.assertEqual(pool_denied.reason, "ROOT_CREDENTIAL_POOL_MATERIALIZATION_FORBIDDEN")

    def test_issue_grant_enforces_profile_owner_operation_ttl_and_budget(self):
        self.assertEqual(
            issue_credential_grant(reference=credential_ref(), request=grant_request(profile_id="content-director"), audit_sink=AuditSinkState(True)).reason,
            "PROFILE_NOT_ALLOWED_FOR_CREDENTIAL_REF",
        )
        self.assertEqual(
            issue_credential_grant(reference=credential_ref(), request=grant_request(owner_principal_id="owner-2"), audit_sink=AuditSinkState(True)).reason,
            "CREDENTIAL_REF_OWNER_MISMATCH",
        )
        self.assertEqual(
            issue_credential_grant(reference=credential_ref(), request=grant_request(operation_allowlist=("admin.delete",)), audit_sink=AuditSinkState(True)).reason,
            "OPERATION_NOT_ALLOWED_FOR_CREDENTIAL_REF",
        )
        self.assertEqual(issue_credential_grant(reference=credential_ref(), request=grant_request(ttl_seconds=901), audit_sink=AuditSinkState(True)).reason, "GRANT_TTL_INVALID")
        self.assertEqual(issue_credential_grant(reference=credential_ref(), request=grant_request(budget_requests=0), audit_sink=AuditSinkState(True)).reason, "GRANT_BUDGET_INVALID")

    def test_oauth_refresh_owner_only_compare_and_swap_without_secret_write(self):
        reference = credential_ref()
        accepted = validate_oauth_refresh_request(
            OAuthRefreshRequest("owner", "owner-1", "cred_ref_openai_primary", "rot-1", "rot-2"),
            reference,
        )
        worker_denied = validate_oauth_refresh_request(
            OAuthRefreshRequest("worker", "owner-1", "cred_ref_openai_primary", "rot-1", "rot-2"),
            reference,
        )
        cas_denied = validate_oauth_refresh_request(
            OAuthRefreshRequest("owner", "owner-1", "cred_ref_openai_primary", "stale", "rot-2"),
            reference,
        )

        self.assertTrue(accepted.allowed)
        self.assertEqual(accepted.reason, "OAUTH_REFRESH_REQUEST_ACCEPTED_NO_SECRET_WRITE")
        self.assertEqual(worker_denied.reason, "OAUTH_REFRESH_OWNER_ONLY")
        self.assertEqual(cas_denied.reason, "OAUTH_REFRESH_COMPARE_AND_SWAP_FAILED")


if __name__ == "__main__":
    unittest.main()
