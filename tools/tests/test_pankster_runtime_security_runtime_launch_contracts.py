import unittest

from tools.pankster_runtime_security.runtime_launch_contracts import (
    ProfileEnvironmentPolicy,
    RuntimeLaunchContext,
    build_child_environment,
    prepare_retry_reclaim_restart,
    prepare_runtime_launch,
)


def policy(**overrides):
    values = {"profile_id": "dev-director", "allowed_environment_keys": ("SAFE_FEATURE_FLAG",)}
    values.update(overrides)
    return ProfileEnvironmentPolicy(**values)


def context(**overrides):
    values = {
        "owner_approval_verified": True,
        "profile_id": "dev-director",
        "workflow_id": "workflow-1",
        "task_id": "task-1",
        "attempt_id": "attempt-1",
        "runtime_identity_hash": "runtime-hash",
        "network_policy_id": "deny-all",
        "policy_version": "policy-v1",
        "grant_refs": ("grant_ref_abc",),
    }
    values.update(overrides)
    return RuntimeLaunchContext(**values)


class PanksterRuntimeSecurityRuntimeLaunchContractTests(unittest.TestCase):
    def test_child_environment_preserves_system_no_proxy_and_hermes_keys(self):
        result = build_child_environment(
            source_environment={"PATH": "/usr/bin", "HOME": "/home/synthetic", "NO_PROXY": "localhost", "no_proxy": "127.0.0.1"},
            profile_policy=policy(),
            context=context(),
        )

        self.assertEqual(result.env["PATH"], "/usr/bin")
        self.assertEqual(result.env["NO_PROXY"], "localhost")
        self.assertEqual(result.env["no_proxy"], "127.0.0.1")
        self.assertEqual(result.env["HERMES_KANBAN_PROFILE_ID"], "dev-director")
        self.assertEqual(result.env["HERMES_KANBAN_GRANT_REFS"], "grant_ref_abc")

    def test_child_environment_denies_sensitive_keys_before_profile_allowlist(self):
        result = build_child_environment(
            source_environment={"SAFE_FEATURE_FLAG": "1", "OPENAI_API_KEY": "redacted-fixture", "TELEGRAM_BOT_TOKEN": "redacted-fixture", "UNKNOWN": "ignored"},
            profile_policy=policy(allowed_environment_keys=("SAFE_FEATURE_FLAG", "OPENAI_API_KEY")),
            context=context(),
        )

        self.assertEqual(result.env["SAFE_FEATURE_FLAG"], "1")
        self.assertIn("OPENAI_API_KEY", result.denied_keys)
        self.assertIn("TELEGRAM_BOT_TOKEN", result.denied_keys)
        self.assertIn("UNKNOWN", result.ignored_keys)
        self.assertNotIn("OPENAI_API_KEY", result.env)

    def test_prepare_runtime_launch_fails_closed_without_owner_approval_or_audit(self):
        missing_approval = prepare_runtime_launch(
            source_environment={"PATH": "/usr/bin"},
            profile_policy=policy(),
            context=context(owner_approval_verified=False),
            audit_available=True,
            broker_available=True,
        )
        audit_denied = prepare_runtime_launch(
            source_environment={"PATH": "/usr/bin"},
            profile_policy=policy(),
            context=context(),
            audit_available=False,
            broker_available=True,
        )

        self.assertEqual(missing_approval.reason, "OWNER_APPROVAL_MISSING")
        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(audit_denied.sanitized_environment.env, {})

    def test_prepare_runtime_launch_never_starts_runtime_in_contract_layer(self):
        result = prepare_runtime_launch(
            source_environment={"PATH": "/usr/bin", "SAFE_FEATURE_FLAG": "1"},
            profile_policy=policy(),
            context=context(),
            audit_available=True,
            broker_available=True,
        )

        self.assertFalse(result.allowed)
        self.assertEqual(result.reason, "RUNTIME_LAUNCH_NOT_IMPLEMENTED")
        self.assertEqual(result.lifecycle_state, "grant_refs_attached")
        self.assertFalse(result.runtime_started)

    def test_retry_reclaim_restart_revalidates_attempt_bound_context(self):
        accepted = prepare_retry_reclaim_restart(original_context=context(), next_context=context())
        denied = prepare_retry_reclaim_restart(original_context=context(), next_context=context(attempt_id="attempt-2"))

        self.assertEqual(accepted.reason, "REVALIDATED_NOT_IMPLEMENTED")
        self.assertEqual(denied.reason, "REVALIDATION_CONTEXT_MISMATCH:attempt_id")


if __name__ == "__main__":
    unittest.main()
