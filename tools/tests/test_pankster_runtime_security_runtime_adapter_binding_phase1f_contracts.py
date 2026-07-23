import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.runtime_adapter_binding_contracts import (
    REQUIRED_ADAPTER_CAPABILITIES,
    RuntimeAdapterBindingRequest,
    RuntimeAdapterIdentity,
)
from tools.pankster_runtime_security.runtime_adapter_binding_phase1f_contracts import (
    Phase1FVersionedAdapterBindingConfig,
    Phase1FVersionedAdapterBindingRequest,
    prepare_phase_1f_versioned_adapter_binding,
)
from tools.pankster_runtime_security.runtime_integration_contracts import RuntimeIntegrationRequest
from tools.pankster_runtime_security.runtime_integration_phase1f_contracts import (
    PHASE_1F_A5R_APPROVAL_COMMAND_SHA256,
    Phase1FVersionedImplementationScopeAttestation,
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
        "adapter_contract_version": "phase-1f-a6",
        "runtime_backend": "disabled-local-contract",
        "capabilities": tuple(sorted(REQUIRED_ADAPTER_CAPABILITIES)),
    }
    values.update(overrides)
    return RuntimeAdapterIdentity(**values)


def base_binding_request(**overrides):
    values = {
        "adapter_identity": adapter_identity(),
        "integration_request": integration_request(),
        "expected_profile_id": "dev-director",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_policy_version": "policy-v1",
    }
    values.update(overrides)
    return RuntimeAdapterBindingRequest(**values)


def scope_attestation(**overrides):
    values = {
        "owner_approval_command_sha256": PHASE_1F_A5R_APPROVAL_COMMAND_SHA256,
        "changed_files": (
            "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
            "tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py",
        ),
    }
    values.update(overrides)
    return Phase1FVersionedImplementationScopeAttestation(**values)


def phase1f_request(**overrides):
    values = {
        "base_binding_request": base_binding_request(),
        "implementation_scope_attestation": scope_attestation(),
    }
    values.update(overrides)
    return Phase1FVersionedAdapterBindingRequest(**values)


class PanksterRuntimeSecurityRuntimeAdapterBindingPhase1FContractTests(unittest.TestCase):
    def test_phase_1f_versioned_binding_is_disabled_by_default_and_starts_nothing(self):
        decision = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_ADAPTER_BINDING_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.hermes_core_changed)

    def test_phase_1f_versioned_binding_requires_scope_attestation(self):
        decision = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(implementation_scope_attestation=None),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")

    def test_phase_1f_versioned_binding_rejects_denied_scope_before_base_binding(self):
        decision = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(implementation_scope_attestation=scope_attestation(changed_files=("web_server.py",))),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:web_server.py")
        self.assertFalse(decision.implementation_scope_decision.runtime_started)

    def test_phase_1f_versioned_binding_prepares_manifest_without_runtime_binding(self):
        decision = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_ADAPTER_BINDING_READY_NO_RUNTIME_BOUND")
        self.assertTrue(decision.implementation_scope_decision.allowed)
        self.assertEqual(decision.base_binding_decision.reason, "RUNTIME_ADAPTER_BINDING_CONTRACT_READY_NO_RUNTIME_BOUND")
        self.assertEqual(decision.binding_manifest["phase"], "1F-A6")
        self.assertEqual(decision.binding_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.binding_manifest["allowed"], "true")
        self.assertFalse(decision.runtime_started)

    def test_phase_1f_versioned_binding_rejects_gateway_core_runtime_launch_and_bad_contract_version(self):
        for kwargs, reason in (
            ({"gateway_binding_enabled": True}, "GATEWAY_BINDING_OUT_OF_SCOPE"),
            ({"hermes_core_binding_enabled": True}, "HERMES_CORE_BINDING_OUT_OF_SCOPE"),
            ({"runtime_launch_enabled": True}, "RUNTIME_LAUNCH_OUT_OF_SCOPE_FOR_BINDING"),
        ):
            decision = prepare_phase_1f_versioned_adapter_binding(
                request=phase1f_request(),
                config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, **kwargs),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            )
            self.assertEqual(decision.reason, reason)

        bad_contract = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(expected_contract_version=""),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        self.assertEqual(bad_contract.reason, "EXPECTED_CONTRACT_VERSION_MISSING")

    def test_phase_1f_versioned_binding_propagates_base_fail_closed_reasons(self):
        audit_denied = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_phase_1f_versioned_adapter_binding(
            request=phase1f_request(),
            config=Phase1FVersionedAdapterBindingConfig(binding_enabled=True, integration_enabled=True, broker_channel_enabled=True),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
