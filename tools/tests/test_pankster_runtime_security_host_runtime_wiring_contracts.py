import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_adapter_integration_contracts import (
    REQUIRED_HOST_CAPABILITIES,
    HostAdapterIdentity,
    HostAdapterIntegrationRequest,
)
from tools.pankster_runtime_security.host_runtime_execution_contracts import (
    REQUIRED_EXECUTION_CAPABILITIES,
    HostRuntimeExecutionIdentity,
    HostRuntimeExecutionRequest,
)
from tools.pankster_runtime_security.host_runtime_wiring_contracts import (
    REQUIRED_WIRING_CAPABILITIES,
    HostRuntimeWiringConfig,
    HostRuntimeWiringIdentity,
    HostRuntimeWiringRequest,
    prepare_host_runtime_wiring,
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
        "adapter_contract_version": "phase-1e-a24",
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
        "host_contract_version": "phase-1e-a24",
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


def execution_identity(**overrides):
    values = {
        "executor_name": "local-disabled-host-runtime-executor",
        "executor_version": "1",
        "execution_contract_version": "phase-1e-a24",
        "capabilities": tuple(sorted(REQUIRED_EXECUTION_CAPABILITIES)),
    }
    values.update(overrides)
    return HostRuntimeExecutionIdentity(**values)


def execution_request(**overrides):
    values = {
        "execution_identity": execution_identity(),
        "host_request": host_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
    }
    values.update(overrides)
    return HostRuntimeExecutionRequest(**values)


def wiring_identity(**overrides):
    values = {
        "wiring_name": "local-disabled-host-runtime-wiring",
        "wiring_version": "1",
        "wiring_contract_version": "phase-1e-a24",
        "capabilities": tuple(sorted(REQUIRED_WIRING_CAPABILITIES)),
    }
    values.update(overrides)
    return HostRuntimeWiringIdentity(**values)


def wiring_request(**overrides):
    values = {
        "wiring_identity": wiring_identity(),
        "execution_request": execution_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
        "wiring_policy_id": "wiring-policy-v1",
    }
    values.update(overrides)
    return HostRuntimeWiringRequest(**values)


def enabled_config(**overrides):
    values = {
        "wiring_contract_enabled": True,
        "execution_contract_enabled": True,
        "host_integration_enabled": True,
        "adapter_binding_enabled": True,
        "runtime_integration_enabled": True,
        "broker_channel_enabled": True,
    }
    values.update(overrides)
    return HostRuntimeWiringConfig(**values)


class PanksterRuntimeSecurityHostRuntimeWiringContractTests(unittest.TestCase):
    def test_default_host_runtime_wiring_is_disabled_and_starts_nothing(self):
        decision = prepare_host_runtime_wiring(
            request=wiring_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "HOST_RUNTIME_WIRING_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.model_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.hermes_core_changed)
        self.assertFalse(decision.dependency_changed)

    def test_enabled_wiring_contract_prepares_secret_free_manifest_without_wiring(self):
        decision = prepare_host_runtime_wiring(
            request=wiring_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED")
        self.assertEqual(decision.execution_decision.reason, "HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED")
        self.assertEqual(decision.wiring_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.wiring_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.wiring_manifest["wiring_policy_id"], "wiring-policy-v1")
        self.assertNotIn("credential", str(decision.wiring_manifest).lower())
        self.assertFalse(decision.gateway_changed)

    def test_wiring_contract_rejects_out_of_scope_runtime_and_host_flags(self):
        cases = [
            ("gateway_wiring_enabled", "GATEWAY_WIRING_OUT_OF_SCOPE"),
            ("hermes_core_wiring_enabled", "HERMES_CORE_WIRING_OUT_OF_SCOPE"),
            ("dependency_changes_enabled", "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
            ("runtime_process_launch_enabled", "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("subprocess_launch_enabled", "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("sandbox_creation_enabled", "SANDBOX_CREATION_OUT_OF_SCOPE"),
            ("provider_model_api_enabled", "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
            ("credential_materialization_enabled", "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"),
        ]
        for flag, reason in cases:
            with self.subTest(flag=flag):
                decision = prepare_host_runtime_wiring(
                    request=wiring_request(),
                    config=enabled_config(**{flag: True}),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_wiring_contract_requires_wiring_identity_capabilities(self):
        missing_name = prepare_host_runtime_wiring(
            request=wiring_request(wiring_identity=wiring_identity(wiring_name="")),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        missing_capability = prepare_host_runtime_wiring(
            request=wiring_request(wiring_identity=wiring_identity(capabilities=("fail_closed",))),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_name.reason, "WIRING_IDENTITY_FIELD_MISSING:wiring_name")
        self.assertTrue(missing_capability.reason.startswith("WIRING_CAPABILITY_MISSING:"))

    def test_wiring_contract_revalidates_profile_policy_backend_rollback_and_wiring(self):
        cases = [
            ({"expected_profile_id": "content-director"}, "EXPECTED_PROFILE_MISMATCH"),
            ({"expected_runtime_backend": "other-backend"}, "EXPECTED_RUNTIME_BACKEND_MISMATCH"),
            ({"expected_rollback_policy_id": "other-rollback"}, "EXPECTED_ROLLBACK_POLICY_MISMATCH"),
            ({"wiring_policy_id": ""}, "WIRING_POLICY_MISSING"),
        ]
        for overrides, reason in cases:
            with self.subTest(reason=reason):
                decision = prepare_host_runtime_wiring(
                    request=wiring_request(**overrides),
                    config=enabled_config(),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_wiring_contract_propagates_execution_fail_closed_reasons(self):
        audit_denied = prepare_host_runtime_wiring(
            request=wiring_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_host_runtime_wiring(
            request=wiring_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_execution_denied = prepare_host_runtime_wiring(
            request=wiring_request(),
            config=enabled_config(execution_contract_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_execution_denied.reason, "HOST_RUNTIME_EXECUTION_DISABLED")


if __name__ == "__main__":
    unittest.main()
