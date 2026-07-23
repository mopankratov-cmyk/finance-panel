import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_adapter_integration_contracts import (
    REQUIRED_HOST_CAPABILITIES,
    HostAdapterIdentity,
    HostAdapterIntegrationConfig,
    HostAdapterIntegrationRequest,
    prepare_host_adapter_integration,
)
from tools.pankster_runtime_security.runtime_adapter_binding_contracts import (
    REQUIRED_ADAPTER_CAPABILITIES,
    RuntimeAdapterBindingRequest,
    RuntimeAdapterIdentity,
)
from tools.pankster_runtime_security.runtime_integration_contracts import RuntimeIntegrationRequest
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


def profile_policy(**overrides):
    values = {"profile_id": "dev-director", "allowed_environment_keys": ("SAFE_FEATURE_FLAG",)}
    values.update(overrides)
    return ProfileEnvironmentPolicy(**values)


def integration_request(**overrides):
    values = {
        "context": context(),
        "profile_environment_policy": profile_policy(),
        "source_environment": {"PATH": "/usr/bin", "NO_PROXY": "localhost", "SAFE_FEATURE_FLAG": "1"},
        "child_surfaces": ("terminal", "code_execution", "delegate_task", "mcp", "background_process"),
        "credential_grant_refs": ("grant_ref_abc",),
        "model_broker_required": True,
    }
    values.update(overrides)
    return RuntimeIntegrationRequest(**values)


def adapter_identity(**overrides):
    values = {
        "adapter_name": "local-disabled-contract-adapter",
        "adapter_version": "1",
        "adapter_contract_version": "phase-1e-a18",
        "runtime_backend": "disabled-local-contract",
        "capabilities": tuple(sorted(REQUIRED_ADAPTER_CAPABILITIES)),
    }
    values.update(overrides)
    return RuntimeAdapterIdentity(**values)


def binding_request(**overrides):
    values = {
        "adapter_identity": adapter_identity(),
        "integration_request": integration_request(),
        "expected_profile_id": "dev-director",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_policy_version": "policy-v1",
    }
    values.update(overrides)
    return RuntimeAdapterBindingRequest(**values)


def host_identity(**overrides):
    values = {
        "host_adapter_name": "local-disabled-host-adapter",
        "host_adapter_version": "1",
        "host_contract_version": "phase-1e-a18",
        "capabilities": tuple(sorted(REQUIRED_HOST_CAPABILITIES)),
    }
    values.update(overrides)
    return HostAdapterIdentity(**values)


def host_request(**overrides):
    values = {
        "host_identity": host_identity(),
        "binding_request": binding_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "rollback_policy_id": "rollback-policy-v1",
    }
    values.update(overrides)
    return HostAdapterIntegrationRequest(**values)


class PanksterRuntimeSecurityHostAdapterIntegrationContractTests(unittest.TestCase):
    def test_default_host_integration_is_disabled_and_starts_nothing(self):
        decision = prepare_host_adapter_integration(
            request=host_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "HOST_ADAPTER_INTEGRATION_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.hermes_core_changed)
        self.assertFalse(decision.dependency_changed)

    def test_enabled_host_contract_prepares_secret_free_manifest_without_runtime(self):
        decision = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(
                host_integration_enabled=True,
                adapter_binding_enabled=True,
                runtime_integration_enabled=True,
                broker_channel_enabled=True,
            ),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "HOST_ADAPTER_INTEGRATION_CONTRACT_READY_NO_RUNTIME_INTEGRATED")
        self.assertEqual(decision.binding_decision.reason, "RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND")
        self.assertEqual(decision.host_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.host_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.host_manifest["rollback_policy_id"], "rollback-policy-v1")
        self.assertNotIn("credential", str(decision.host_manifest).lower())
        self.assertFalse(decision.runtime_started)

    def test_host_contract_rejects_gateway_core_and_runtime_launch_flags(self):
        gateway_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, gateway_integration_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        core_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, hermes_core_integration_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        launch_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, runtime_launch_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(gateway_denied.reason, "GATEWAY_INTEGRATION_OUT_OF_SCOPE")
        self.assertEqual(core_denied.reason, "HERMES_CORE_INTEGRATION_OUT_OF_SCOPE")
        self.assertEqual(launch_denied.reason, "RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_HOST_INTEGRATION")

    def test_host_contract_requires_host_identity_capabilities(self):
        missing_name = prepare_host_adapter_integration(
            request=host_request(host_identity=host_identity(host_adapter_name="")),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        missing_capability = prepare_host_adapter_integration(
            request=host_request(host_identity=host_identity(capabilities=("fail_closed",))),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_name.reason, "HOST_ADAPTER_IDENTITY_FIELD_MISSING:host_adapter_name")
        self.assertTrue(missing_capability.reason.startswith("HOST_ADAPTER_CAPABILITY_MISSING:"))

    def test_host_contract_revalidates_profile_policy_backend_and_rollback(self):
        self.assertEqual(
            prepare_host_adapter_integration(
                request=host_request(expected_profile_id="content-director"),
                config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "EXPECTED_PROFILE_MISMATCH",
        )
        self.assertEqual(
            prepare_host_adapter_integration(
                request=host_request(expected_runtime_backend="other-backend"),
                config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "EXPECTED_RUNTIME_BACKEND_MISMATCH",
        )
        self.assertEqual(
            prepare_host_adapter_integration(
                request=host_request(rollback_policy_id=""),
                config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "ROLLBACK_POLICY_MISSING",
        )

    def test_host_contract_propagates_binding_fail_closed_reasons(self):
        audit_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=True, runtime_integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_binding_denied = prepare_host_adapter_integration(
            request=host_request(),
            config=HostAdapterIntegrationConfig(host_integration_enabled=True, adapter_binding_enabled=False, runtime_integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_binding_denied.reason, "RUNTIME_ADAPTER_BINDING_DISABLED")


if __name__ == "__main__":
    unittest.main()
