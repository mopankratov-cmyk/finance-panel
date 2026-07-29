import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_adapter_binding_contracts import (
    REQUIRED_ADAPTER_CAPABILITIES,
    RuntimeAdapterBindingConfig,
    RuntimeAdapterBindingRequest,
    RuntimeAdapterIdentity,
    prepare_runtime_adapter_binding,
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
        "adapter_contract_version": "phase-1e-a15",
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


class PanksterRuntimeSecurityRuntimeAdapterBindingContractTests(unittest.TestCase):
    def test_default_binding_is_disabled_and_starts_nothing(self):
        decision = prepare_runtime_adapter_binding(
            request=binding_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_ADAPTER_BINDING_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.hermes_core_changed)

    def test_enabled_binding_prepares_manifest_without_runtime_binding(self):
        decision = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND")
        self.assertEqual(decision.integration_decision.reason, "DISABLED_RUNTIME_INTEGRATION_CONTRACT_READY_NO_RUNTIME_STARTED")
        self.assertEqual(decision.binding_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.binding_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.binding_manifest["grant_refs"], "grant_ref_abc")
        self.assertFalse(decision.runtime_started)

    def test_binding_rejects_gateway_core_and_runtime_launch_flags(self):
        gateway_denied = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, gateway_binding_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        core_denied = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, hermes_core_binding_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        launch_denied = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, runtime_launch_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(gateway_denied.reason, "GATEWAY_BINDING_OUT_OF_SCOPE")
        self.assertEqual(core_denied.reason, "HERMES_CORE_BINDING_OUT_OF_SCOPE")
        self.assertEqual(launch_denied.reason, "RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_BINDING")

    def test_binding_requires_adapter_identity_capabilities(self):
        missing_name = prepare_runtime_adapter_binding(
            request=binding_request(adapter_identity=adapter_identity(adapter_name="")),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        missing_capability = prepare_runtime_adapter_binding(
            request=binding_request(adapter_identity=adapter_identity(capabilities=("fail_closed",))),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_name.reason, "ADAPTER_IDENTITY_FIELD_MISSING:adapter_name")
        self.assertTrue(missing_capability.reason.startswith("ADAPTER_CAPABILITY_MISSING:"))

    def test_binding_revalidates_expected_profile_backend_and_policy(self):
        self.assertEqual(
            prepare_runtime_adapter_binding(
                request=binding_request(expected_profile_id="content-director"),
                config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "EXPECTED_PROFILE_MISMATCH",
        )
        self.assertEqual(
            prepare_runtime_adapter_binding(
                request=binding_request(expected_runtime_backend="other-backend"),
                config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "EXPECTED_RUNTIME_BACKEND_MISMATCH",
        )
        self.assertEqual(
            prepare_runtime_adapter_binding(
                request=binding_request(expected_policy_version="policy-v2"),
                config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            ).reason,
            "EXPECTED_POLICY_VERSION_MISMATCH",
        )

    def test_binding_propagates_integration_fail_closed_reasons(self):
        audit_denied = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_runtime_adapter_binding(
            request=binding_request(),
            config=RuntimeAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
