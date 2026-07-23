import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.host_adapter_integration_contracts import (
    REQUIRED_HOST_CAPABILITIES,
    HostAdapterIdentity,
    HostAdapterIntegrationRequest,
)
from tools.pankster_runtime_security.host_adapter_integration_phase1f_contracts import (
    PHASE_1F_A14_APPROVAL_COMMAND_SHA256,
    Phase1FVersionedHostAdapterImplementationScopeAttestation,
    Phase1FVersionedHostAdapterIntegrationRequest,
)
from tools.pankster_runtime_security.host_runtime_execution_contracts import (
    REQUIRED_EXECUTION_CAPABILITIES,
    HostRuntimeExecutionIdentity,
    HostRuntimeExecutionRequest,
)
from tools.pankster_runtime_security.host_runtime_execution_phase1f_contracts import (
    PHASE_1F_A17_APPROVAL_COMMAND_SHA256,
    PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_FILE_ALLOWLIST,
    Phase1FVersionedHostRuntimeExecutionConfig,
    Phase1FVersionedHostRuntimeExecutionRequest,
    Phase1FVersionedHostRuntimeExecutionScopeAttestation,
    phase_1f_versioned_host_runtime_execution_scope_manifest,
    prepare_phase_1f_versioned_host_runtime_execution,
    validate_phase_1f_versioned_host_runtime_execution_scope,
)
from tools.pankster_runtime_security.runtime_adapter_binding_contracts import (
    REQUIRED_ADAPTER_CAPABILITIES,
    RuntimeAdapterBindingRequest,
    RuntimeAdapterIdentity,
)
from tools.pankster_runtime_security.runtime_adapter_binding_phase1f_contracts import Phase1FVersionedAdapterBindingRequest
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
        "adapter_contract_version": "phase-1f-a18",
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
        "host_contract_version": "phase-1f-a18",
        "capabilities": tuple(sorted(REQUIRED_HOST_CAPABILITIES)),
    }
    values.update(overrides)
    return HostAdapterIdentity(**values)


def host_request(**overrides):
    base_binding = overrides.pop("binding_request", binding_request())
    values = {
        "host_identity": host_identity(),
        "binding_request": base_binding,
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
        "execution_contract_version": "phase-1f-a18",
        "capabilities": tuple(sorted(REQUIRED_EXECUTION_CAPABILITIES)),
    }
    values.update(overrides)
    return HostRuntimeExecutionIdentity(**values)


def execution_request(**overrides):
    base_host = overrides.pop("host_request", host_request())
    values = {
        "execution_identity": execution_identity(),
        "host_request": base_host,
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
    }
    values.update(overrides)
    return HostRuntimeExecutionRequest(**values)


def phase1f_binding_scope_attestation(**overrides):
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


def versioned_binding_request(**overrides):
    values = {
        "base_binding_request": binding_request(),
        "implementation_scope_attestation": phase1f_binding_scope_attestation(),
        "expected_contract_version": "phase-1f-a18",
    }
    values.update(overrides)
    return Phase1FVersionedAdapterBindingRequest(**values)


def host_scope_attestation(**overrides):
    values = {
        "owner_approval_command_sha256": PHASE_1F_A14_APPROVAL_COMMAND_SHA256,
        "changed_files": (
            "tools/pankster_runtime_security/host_adapter_integration_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_host_adapter_integration_phase1f_contracts.py",
        ),
    }
    values.update(overrides)
    return Phase1FVersionedHostAdapterImplementationScopeAttestation(**values)


def versioned_host_request(**overrides):
    base_binding = binding_request()
    base_host = overrides.pop("base_host_request", host_request(binding_request=base_binding))
    values = {
        "base_host_request": base_host,
        "versioned_binding_request": versioned_binding_request(base_binding_request=base_binding),
        "implementation_scope_attestation": host_scope_attestation(),
        "expected_host_contract_version": "phase-1f-a18",
    }
    values.update(overrides)
    return Phase1FVersionedHostAdapterIntegrationRequest(**values)


def runtime_scope_attestation(**overrides):
    values = {
        "owner_approval_command_sha256": PHASE_1F_A17_APPROVAL_COMMAND_SHA256,
        "changed_files": (
            "tools/pankster_runtime_security/host_runtime_execution_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_host_runtime_execution_phase1f_contracts.py",
        ),
    }
    values.update(overrides)
    return Phase1FVersionedHostRuntimeExecutionScopeAttestation(**values)


def phase1f_runtime_request(**overrides):
    base_binding = binding_request()
    base_host = host_request(binding_request=base_binding)
    values = {
        "base_execution_request": execution_request(host_request=base_host),
        "versioned_host_request": versioned_host_request(base_host_request=base_host),
        "implementation_scope_attestation": runtime_scope_attestation(),
    }
    values.update(overrides)
    return Phase1FVersionedHostRuntimeExecutionRequest(**values)


def enabled_config(**overrides):
    values = {
        "execution_contract_enabled": True,
        "host_integration_enabled": True,
        "adapter_binding_enabled": True,
        "runtime_integration_enabled": True,
        "broker_channel_enabled": True,
    }
    values.update(overrides)
    return Phase1FVersionedHostRuntimeExecutionConfig(**values)


class PanksterRuntimeSecurityHostRuntimeExecutionPhase1FContractTests(unittest.TestCase):
    def test_phase_1f_host_runtime_scope_accepts_only_new_allowlisted_files(self):
        decision = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation())

        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_PURE_CONTRACT_SCOPE_ACCEPTED_NO_RUNTIME")
        self.assertEqual(decision.approved_file_scope, tuple(sorted(PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_FILE_ALLOWLIST)))
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.runtime_bound)
        self.assertFalse(decision.profile_runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.auth_store_read)
        self.assertFalse(decision.keychain_read)

    def test_phase_1f_host_runtime_scope_rejects_bad_approval_duplicate_missing_pinned_and_unknown_files(self):
        bad_approval = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation(owner_approval_command_sha256="bad"))
        duplicate = validate_phase_1f_versioned_host_runtime_execution_scope(
            runtime_scope_attestation(changed_files=("tools/pankster_runtime_security/host_runtime_execution_phase1f_contracts.py", "tools/pankster_runtime_security/host_runtime_execution_phase1f_contracts.py"))
        )
        missing = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation(changed_files=()))
        pinned = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation(changed_files=("tools/pankster_runtime_security/host_runtime_execution_contracts.py",)))
        unknown = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation(changed_files=("gateway.py",)))

        self.assertEqual(bad_approval.reason, "OWNER_APPROVAL_HASH_MISMATCH")
        self.assertEqual(duplicate.reason, "IMPLEMENTATION_FILE_DUPLICATE")
        self.assertEqual(missing.reason, "IMPLEMENTATION_FILES_MISSING")
        self.assertEqual(pinned.reason, "PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:tools/pankster_runtime_security/host_runtime_execution_contracts.py")
        self.assertEqual(unknown.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:gateway.py")

    def test_phase_1f_host_runtime_scope_rejects_runtime_credentials_api_and_deploy_flags(self):
        for flag in (
            "runtime_process_launch_requested",
            "runtime_binding_requested",
            "profile_runtime_execution_requested",
            "subprocess_launch_requested",
            "sandbox_launch_requested",
            "provider_api_call_requested",
            "model_api_call_requested",
            "real_credentials_requested",
            "auth_store_read_requested",
            "keychain_read_requested",
            "process_env_secret_read_requested",
            "oauth_refresh_requested",
            "gateway_change_requested",
            "web_server_change_requested",
            "profile_worker_binding_requested",
            "hermes_core_change_requested",
            "dependency_change_requested",
            "production_profile_requested",
            "canary_requested",
            "deployment_requested",
            "phase_1e_hash_pinned_file_change_requested",
        ):
            decision = validate_phase_1f_versioned_host_runtime_execution_scope(runtime_scope_attestation(**{flag: True}))

            self.assertFalse(decision.allowed)
            self.assertEqual(decision.reason, f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{flag}")

    def test_phase_1f_host_runtime_scope_manifest_contains_no_secret_or_runtime_state(self):
        manifest = phase_1f_versioned_host_runtime_execution_scope_manifest(runtime_scope_attestation())

        self.assertEqual(manifest["host_runtime_scope_allowed"], "true")
        self.assertEqual(manifest["host_runtime_approval_command_sha256"], PHASE_1F_A17_APPROVAL_COMMAND_SHA256)
        self.assertEqual(set(manifest["host_runtime_approved_file_scope"].split(",")), PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_FILE_ALLOWLIST)

    def test_phase_1f_host_runtime_execution_is_disabled_by_default_and_starts_nothing(self):
        decision = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.runtime_bound)
        self.assertFalse(decision.profile_runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.model_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.auth_store_read)
        self.assertFalse(decision.keychain_read)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.web_server_changed)
        self.assertFalse(decision.profile_worker_bound)
        self.assertFalse(decision.hermes_core_changed)
        self.assertFalse(decision.dependency_changed)

    def test_phase_1f_host_runtime_execution_prepares_secret_free_manifest_without_runtime(self):
        decision = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED")
        self.assertTrue(decision.implementation_scope_decision.allowed)
        self.assertEqual(decision.versioned_host_decision.reason, "PHASE_1F_VERSIONED_HOST_ADAPTER_INTEGRATION_READY_NO_RUNTIME_INTEGRATED")
        self.assertEqual(decision.base_execution_decision.reason, "HOST_RUNTIME_EXECUTION_CONTRACT_READY_NO_RUNTIME_STARTED")
        self.assertEqual(decision.execution_manifest["phase"], "1F-A18")
        self.assertEqual(decision.execution_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.execution_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.execution_manifest["rollback_policy_id"], "rollback-policy-v1")
        self.assertEqual(decision.execution_manifest["execution_state"], "versioned_disabled_contract_ready_no_runtime_started")
        self.assertNotIn("api_key", str(decision.execution_manifest).lower())
        self.assertNotIn("token", str(decision.execution_manifest).lower())
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.runtime_bound)

    def test_phase_1f_host_runtime_execution_rejects_missing_scope_bad_scope_mismatch_and_bad_version(self):
        missing_scope = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(implementation_scope_attestation=None),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        bad_scope = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(implementation_scope_attestation=runtime_scope_attestation(changed_files=("web_server.py",))),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        mismatch = prepare_phase_1f_versioned_host_runtime_execution(
            request=Phase1FVersionedHostRuntimeExecutionRequest(
                base_execution_request=execution_request(host_request=host_request(binding_request=binding_request(expected_profile_id="dev-director"))),
                versioned_host_request=versioned_host_request(base_host_request=host_request(binding_request=binding_request(expected_profile_id="content-director"))),
                implementation_scope_attestation=runtime_scope_attestation(),
            ),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        bad_version = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(expected_execution_contract_version=""),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_scope.reason, "HOST_RUNTIME_IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")
        self.assertEqual(bad_scope.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:web_server.py")
        self.assertEqual(mismatch.reason, "VERSIONED_HOST_REQUEST_MISMATCH")
        self.assertEqual(bad_version.reason, "EXPECTED_EXECUTION_CONTRACT_VERSION_MISSING")

    def test_phase_1f_host_runtime_execution_rejects_runtime_launch_binding_gateway_and_propagates_fail_closed(self):
        for kwargs, reason in (
            ({"gateway_integration_enabled": True}, "GATEWAY_INTEGRATION_OUT_OF_SCOPE"),
            ({"web_server_integration_enabled": True}, "WEB_SERVER_INTEGRATION_OUT_OF_SCOPE"),
            ({"profile_worker_binding_enabled": True}, "PROFILE_WORKER_BINDING_OUT_OF_SCOPE"),
            ({"hermes_core_integration_enabled": True}, "HERMES_CORE_INTEGRATION_OUT_OF_SCOPE"),
            ({"dependency_changes_enabled": True}, "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
            ({"runtime_process_launch_enabled": True}, "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
            ({"runtime_binding_enabled": True}, "RUNTIME_BINDING_OUT_OF_SCOPE"),
            ({"profile_runtime_execution_enabled": True}, "PROFILE_RUNTIME_EXECUTION_OUT_OF_SCOPE"),
            ({"subprocess_launch_enabled": True}, "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
            ({"sandbox_creation_enabled": True}, "SANDBOX_CREATION_OUT_OF_SCOPE"),
            ({"provider_model_api_enabled": True}, "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
            ({"credential_materialization_enabled": True}, "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"),
        ):
            decision = prepare_phase_1f_versioned_host_runtime_execution(
                request=phase1f_runtime_request(),
                config=enabled_config(**kwargs),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            )
            self.assertEqual(decision.reason, reason)

        audit_denied = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_host_denied = prepare_phase_1f_versioned_host_runtime_execution(
            request=phase1f_runtime_request(),
            config=enabled_config(host_integration_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_host_denied.reason, "PHASE_1F_VERSIONED_HOST_ADAPTER_INTEGRATION_DISABLED")


if __name__ == "__main__":
    unittest.main()
