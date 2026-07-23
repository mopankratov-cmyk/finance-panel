import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_integration_contracts import (
    RuntimeIntegrationConfig,
    RuntimeIntegrationRequest,
    prepare_disabled_runtime_integration,
)
from tools.pankster_runtime_security.runtime_launch_contracts import ProfileEnvironmentPolicy, RuntimeLaunchContext


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


def policy(**overrides):
    values = {"profile_id": "dev-director", "allowed_environment_keys": ("SAFE_FEATURE_FLAG",)}
    values.update(overrides)
    return ProfileEnvironmentPolicy(**values)


def request(**overrides):
    values = {
        "context": context(),
        "profile_environment_policy": policy(),
        "source_environment": {"PATH": "/usr/bin", "NO_PROXY": "localhost", "SAFE_FEATURE_FLAG": "1"},
        "child_surfaces": ("terminal", "code_execution", "delegate_task", "mcp", "background_process"),
        "credential_grant_refs": ("grant_ref_abc",),
        "model_broker_required": True,
    }
    values.update(overrides)
    return RuntimeIntegrationRequest(**values)


class PanksterRuntimeSecurityRuntimeIntegrationContractTests(unittest.TestCase):
    def test_default_integration_is_disabled_and_starts_nothing(self):
        decision = prepare_disabled_runtime_integration(
            request=request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_INTEGRATION_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.gateway_changed)

    def test_enabled_contract_prepares_all_child_environments_without_runtime_start(self):
        decision = prepare_disabled_runtime_integration(
            request=request(),
            config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "DISABLED_RUNTIME_INTEGRATION_CONTRACT_READY_NO_RUNTIME_STARTED")
        self.assertEqual(set(decision.child_environments), {"terminal", "code_execution", "delegate_task", "mcp", "background_process"})
        for env in decision.child_environments.values():
            self.assertEqual(env.env["PATH"], "/usr/bin")
            self.assertEqual(env.env["NO_PROXY"], "localhost")
            self.assertEqual(env.env["HERMES_KANBAN_PROFILE_ID"], "dev-director")
            self.assertEqual(env.env["HERMES_KANBAN_GRANT_REFS"], "grant_ref_abc")
            self.assertEqual(env.denied_keys, ())
        self.assertFalse(decision.runtime_started)

    def test_enabled_contract_rejects_sensitive_child_environment_keys(self):
        decision = prepare_disabled_runtime_integration(
            request=request(source_environment={"PATH": "/usr/bin", "OPENAI_API_KEY": "redacted-fixture"}),
            config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "CHILD_ENVIRONMENT_DENIED_SENSITIVE_KEY")
        self.assertIn("OPENAI_API_KEY", decision.child_environments["terminal"].denied_keys)
        self.assertNotIn("redacted-fixture", str(decision))

    def test_runtime_launch_flag_remains_out_of_scope(self):
        decision = prepare_disabled_runtime_integration(
            request=request(),
            config=RuntimeIntegrationConfig(integration_enabled=True, runtime_launch_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_CONTRACT")
        self.assertFalse(decision.runtime_started)

    def test_broker_and_audit_are_required_before_integration_boundary(self):
        audit_denied = prepare_disabled_runtime_integration(
            request=request(),
            config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_disabled_runtime_integration(
            request=request(),
            config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        launch_broker_denied = prepare_disabled_runtime_integration(
            request=request(),
            config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_CHANNEL_DISABLED")
        self.assertEqual(launch_broker_denied.reason, "BROKER_UNAVAILABLE")

    def test_context_profile_surface_and_grant_refs_are_revalidated(self):
        self.assertEqual(
            prepare_disabled_runtime_integration(
                request=request(profile_environment_policy=policy(profile_id="content-director")),
                config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "PROFILE_POLICY_MISMATCH",
        )
        self.assertEqual(
            prepare_disabled_runtime_integration(
                request=request(child_surfaces=("terminal", "unknown")),
                config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "CHILD_SURFACE_UNSUPPORTED:unknown",
        )
        self.assertEqual(
            prepare_disabled_runtime_integration(
                request=request(credential_grant_refs=("grant_ref_other",)),
                config=RuntimeIntegrationConfig(integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "CREDENTIAL_GRANT_REFS_CONTEXT_MISMATCH",
        )


if __name__ == "__main__":
    unittest.main()
