import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.gateway_binding_contracts import (
    REQUIRED_GATEWAY_BINDING_CAPABILITIES,
    GatewayBindingIdentity,
    GatewayBindingRequest,
)
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
    HostRuntimeWiringIdentity,
    HostRuntimeWiringRequest,
)
from tools.pankster_runtime_security.profile_worker_binding_contracts import (
    REQUIRED_PROFILE_WORKER_BINDING_CAPABILITIES,
    ProfileWorkerBindingConfig,
    ProfileWorkerBindingIdentity,
    ProfileWorkerBindingRequest,
    prepare_profile_worker_binding,
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
        "adapter_contract_version": "phase-1e-a30",
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
        "host_contract_version": "phase-1e-a30",
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
        "execution_contract_version": "phase-1e-a30",
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
        "wiring_contract_version": "phase-1e-a30",
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


def gateway_binding_identity(**overrides):
    values = {
        "binding_name": "local-disabled-gateway-binding",
        "binding_version": "1",
        "binding_contract_version": "phase-1e-a30",
        "capabilities": tuple(sorted(REQUIRED_GATEWAY_BINDING_CAPABILITIES)),
    }
    values.update(overrides)
    return GatewayBindingIdentity(**values)


def gateway_binding_request(**overrides):
    values = {
        "binding_identity": gateway_binding_identity(),
        "wiring_request": wiring_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
        "expected_wiring_policy_id": "wiring-policy-v1",
        "gateway_binding_policy_id": "gateway-binding-policy-v1",
    }
    values.update(overrides)
    return GatewayBindingRequest(**values)


def profile_worker_binding_identity(**overrides):
    values = {
        "worker_binding_name": "local-disabled-profile-worker-binding",
        "worker_binding_version": "1",
        "worker_binding_contract_version": "phase-1e-a30",
        "capabilities": tuple(sorted(REQUIRED_PROFILE_WORKER_BINDING_CAPABILITIES)),
    }
    values.update(overrides)
    return ProfileWorkerBindingIdentity(**values)


def profile_worker_binding_request(**overrides):
    values = {
        "worker_binding_identity": profile_worker_binding_identity(),
        "gateway_binding_request": gateway_binding_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
        "expected_wiring_policy_id": "wiring-policy-v1",
        "expected_gateway_binding_policy_id": "gateway-binding-policy-v1",
        "profile_worker_binding_policy_id": "profile-worker-binding-policy-v1",
    }
    values.update(overrides)
    return ProfileWorkerBindingRequest(**values)


def enabled_config(**overrides):
    values = {
        "profile_worker_binding_contract_enabled": True,
        "gateway_binding_contract_enabled": True,
        "wiring_contract_enabled": True,
        "execution_contract_enabled": True,
        "host_integration_enabled": True,
        "adapter_binding_enabled": True,
        "runtime_integration_enabled": True,
        "broker_channel_enabled": True,
    }
    values.update(overrides)
    return ProfileWorkerBindingConfig(**values)


class PanksterRuntimeSecurityProfileWorkerBindingContractTests(unittest.TestCase):
    def test_default_profile_worker_binding_is_disabled_and_starts_nothing(self):
        decision = prepare_profile_worker_binding(
            request=profile_worker_binding_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PROFILE_WORKER_BINDING_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.profile_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.model_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.profile_worker_changed)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.web_server_changed)
        self.assertFalse(decision.hermes_core_changed)
        self.assertFalse(decision.dependency_changed)

    def test_enabled_profile_worker_binding_prepares_secret_free_manifest_without_binding(self):
        decision = prepare_profile_worker_binding(
            request=profile_worker_binding_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PROFILE_WORKER_BINDING_CONTRACT_READY_NO_WORKER_BOUND")
        self.assertEqual(decision.gateway_binding_decision.reason, "GATEWAY_BINDING_CONTRACT_READY_NO_GATEWAY_BOUND")
        self.assertEqual(decision.profile_worker_binding_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.profile_worker_binding_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.profile_worker_binding_manifest["profile_worker_binding_policy_id"], "profile-worker-binding-policy-v1")
        self.assertNotIn("credential", str(decision.profile_worker_binding_manifest).lower())
        self.assertFalse(decision.profile_worker_changed)
        self.assertFalse(decision.profile_started)

    def test_profile_worker_binding_rejects_out_of_scope_runtime_and_worker_flags(self):
        cases = [
            ("profile_worker_runtime_mutation_enabled", "PROFILE_WORKER_RUNTIME_MUTATION_OUT_OF_SCOPE"),
            ("profile_start_enabled", "PROFILE_START_OUT_OF_SCOPE"),
            ("gateway_py_binding_enabled", "GATEWAY_PY_BINDING_OUT_OF_SCOPE"),
            ("web_server_py_binding_enabled", "WEB_SERVER_PY_BINDING_OUT_OF_SCOPE"),
            ("gateway_runtime_mutation_enabled", "GATEWAY_RUNTIME_MUTATION_OUT_OF_SCOPE"),
            ("hermes_core_binding_enabled", "HERMES_CORE_BINDING_OUT_OF_SCOPE"),
            ("dependency_changes_enabled", "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
            ("runtime_process_launch_enabled", "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("subprocess_launch_enabled", "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("sandbox_creation_enabled", "SANDBOX_CREATION_OUT_OF_SCOPE"),
            ("provider_model_api_enabled", "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
            ("credential_materialization_enabled", "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"),
        ]
        for flag, reason in cases:
            with self.subTest(flag=flag):
                decision = prepare_profile_worker_binding(
                    request=profile_worker_binding_request(),
                    config=enabled_config(**{flag: True}),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_profile_worker_binding_requires_identity_capabilities(self):
        missing_name = prepare_profile_worker_binding(
            request=profile_worker_binding_request(worker_binding_identity=profile_worker_binding_identity(worker_binding_name="")),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        missing_capability = prepare_profile_worker_binding(
            request=profile_worker_binding_request(worker_binding_identity=profile_worker_binding_identity(capabilities=("fail_closed",))),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_name.reason, "PROFILE_WORKER_BINDING_IDENTITY_FIELD_MISSING:worker_binding_name")
        self.assertTrue(missing_capability.reason.startswith("PROFILE_WORKER_BINDING_CAPABILITY_MISSING:"))

    def test_profile_worker_binding_revalidates_profile_policy_backend_rollback_wiring_gateway_and_worker(self):
        cases = [
            ({"expected_profile_id": "content-director"}, "EXPECTED_PROFILE_MISMATCH"),
            ({"expected_runtime_backend": "other-backend"}, "EXPECTED_RUNTIME_BACKEND_MISMATCH"),
            ({"expected_rollback_policy_id": "other-rollback"}, "EXPECTED_ROLLBACK_POLICY_MISMATCH"),
            ({"expected_wiring_policy_id": "other-wiring"}, "EXPECTED_WIRING_POLICY_MISMATCH"),
            ({"expected_gateway_binding_policy_id": "other-gateway-binding"}, "EXPECTED_GATEWAY_BINDING_POLICY_MISMATCH"),
            ({"profile_worker_binding_policy_id": ""}, "PROFILE_WORKER_BINDING_POLICY_MISSING"),
        ]
        for overrides, reason in cases:
            with self.subTest(reason=reason):
                decision = prepare_profile_worker_binding(
                    request=profile_worker_binding_request(**overrides),
                    config=enabled_config(),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_profile_worker_binding_propagates_gateway_fail_closed_reasons(self):
        audit_denied = prepare_profile_worker_binding(
            request=profile_worker_binding_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_profile_worker_binding(
            request=profile_worker_binding_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_gateway_denied = prepare_profile_worker_binding(
            request=profile_worker_binding_request(),
            config=enabled_config(gateway_binding_contract_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_gateway_denied.reason, "GATEWAY_BINDING_DISABLED")


if __name__ == "__main__":
    unittest.main()
