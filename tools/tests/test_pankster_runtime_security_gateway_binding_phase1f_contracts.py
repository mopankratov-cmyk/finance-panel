import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.gateway_binding_contracts import (
    REQUIRED_GATEWAY_BINDING_CAPABILITIES,
    GatewayBindingIdentity,
    GatewayBindingRequest,
)
from tools.pankster_runtime_security.gateway_binding_phase1f_contracts import (
    PHASE_1F_A23_APPROVAL_COMMAND_SHA256,
    PHASE_1F_VERSIONED_GATEWAY_BINDING_FILE_ALLOWLIST,
    Phase1FVersionedGatewayBindingConfig,
    Phase1FVersionedGatewayBindingRequest,
    Phase1FVersionedGatewayBindingScopeAttestation,
    phase_1f_versioned_gateway_binding_scope_manifest,
    prepare_phase_1f_versioned_gateway_binding,
    validate_phase_1f_versioned_gateway_binding_scope,
)
from tools.tests.test_pankster_runtime_security_host_runtime_wiring_phase1f_contracts import (
    base_wiring_request,
    execution_request,
    versioned_execution_request,
    wiring_scope_attestation,
)
from tools.pankster_runtime_security.host_runtime_wiring_phase1f_contracts import Phase1FVersionedHostRuntimeWiringRequest


def gateway_binding_identity(**overrides):
    values = {
        "binding_name": "local-disabled-gateway-binding",
        "binding_version": "1",
        "binding_contract_version": "phase-1f-a24",
        "capabilities": tuple(sorted(REQUIRED_GATEWAY_BINDING_CAPABILITIES)),
    }
    values.update(overrides)
    return GatewayBindingIdentity(**values)


def gateway_binding_request(**overrides):
    base_wiring = overrides.pop("wiring_request", base_wiring_request())
    values = {
        "binding_identity": gateway_binding_identity(),
        "wiring_request": base_wiring,
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
        "expected_wiring_policy_id": "wiring-policy-v1",
        "gateway_binding_policy_id": "gateway-binding-policy-v1",
    }
    values.update(overrides)
    return GatewayBindingRequest(**values)


def gateway_scope_attestation(**overrides):
    values = {
        "owner_approval_command_sha256": PHASE_1F_A23_APPROVAL_COMMAND_SHA256,
        "changed_files": (
            "tools/pankster_runtime_security/gateway_binding_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_gateway_binding_phase1f_contracts.py",
        ),
    }
    values.update(overrides)
    return Phase1FVersionedGatewayBindingScopeAttestation(**values)


def phase1f_gateway_request(**overrides):
    base_execution = execution_request()
    base_wiring = base_wiring_request(execution_request=base_execution)
    values = {
        "base_gateway_binding_request": gateway_binding_request(wiring_request=base_wiring),
        "versioned_wiring_request": Phase1FVersionedHostRuntimeWiringRequest(
            base_wiring_request=base_wiring,
            versioned_execution_request=versioned_execution_request(base_execution_request=base_execution),
            implementation_scope_attestation=wiring_scope_attestation(),
        ),
        "implementation_scope_attestation": gateway_scope_attestation(),
    }
    values.update(overrides)
    return Phase1FVersionedGatewayBindingRequest(**values)


def enabled_config(**overrides):
    values = {
        "gateway_binding_contract_enabled": True,
        "wiring_contract_enabled": True,
        "execution_contract_enabled": True,
        "host_integration_enabled": True,
        "adapter_binding_enabled": True,
        "runtime_integration_enabled": True,
        "broker_channel_enabled": True,
    }
    values.update(overrides)
    return Phase1FVersionedGatewayBindingConfig(**values)


class PanksterRuntimeSecurityGatewayBindingPhase1FContractTests(unittest.TestCase):
    def test_phase_1f_gateway_binding_scope_accepts_only_new_allowlisted_files(self):
        decision = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation())

        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_GATEWAY_BINDING_PURE_CONTRACT_SCOPE_ACCEPTED_NO_GATEWAY_BOUND")
        self.assertEqual(decision.approved_file_scope, tuple(sorted(PHASE_1F_VERSIONED_GATEWAY_BINDING_FILE_ALLOWLIST)))
        self.assertFalse(decision.gateway_bound)
        self.assertFalse(decision.gateway_runtime_mutated)
        self.assertFalse(decision.web_server_changed)
        self.assertFalse(decision.profile_worker_wired)
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)

    def test_phase_1f_gateway_binding_scope_rejects_bad_approval_duplicate_missing_pinned_and_unknown_files(self):
        bad_approval = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation(owner_approval_command_sha256="bad"))
        duplicate = validate_phase_1f_versioned_gateway_binding_scope(
            gateway_scope_attestation(changed_files=("tools/pankster_runtime_security/gateway_binding_phase1f_contracts.py", "tools/pankster_runtime_security/gateway_binding_phase1f_contracts.py"))
        )
        missing = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation(changed_files=()))
        pinned = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation(changed_files=("tools/pankster_runtime_security/gateway_binding_contracts.py",)))
        unknown = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation(changed_files=("gateway.py",)))

        self.assertEqual(bad_approval.reason, "OWNER_APPROVAL_HASH_MISMATCH")
        self.assertEqual(duplicate.reason, "IMPLEMENTATION_FILE_DUPLICATE")
        self.assertEqual(missing.reason, "IMPLEMENTATION_FILES_MISSING")
        self.assertEqual(pinned.reason, "PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:tools/pankster_runtime_security/gateway_binding_contracts.py")
        self.assertEqual(unknown.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:gateway.py")

    def test_phase_1f_gateway_binding_scope_rejects_gateway_runtime_credentials_api_and_deploy_flags(self):
        for flag in (
            "gateway_py_import_requested",
            "gateway_py_change_requested",
            "web_server_py_import_requested",
            "web_server_py_change_requested",
            "gateway_runtime_mutation_requested",
            "profile_worker_wiring_requested",
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
            "hermes_core_change_requested",
            "dependency_change_requested",
            "production_profile_requested",
            "canary_requested",
            "deployment_requested",
            "phase_1e_hash_pinned_file_change_requested",
        ):
            decision = validate_phase_1f_versioned_gateway_binding_scope(gateway_scope_attestation(**{flag: True}))

            self.assertFalse(decision.allowed)
            self.assertEqual(decision.reason, f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{flag}")

    def test_phase_1f_gateway_binding_scope_manifest_contains_no_secret_or_runtime_state(self):
        manifest = phase_1f_versioned_gateway_binding_scope_manifest(gateway_scope_attestation())

        self.assertEqual(manifest["gateway_binding_scope_allowed"], "true")
        self.assertEqual(manifest["gateway_binding_approval_command_sha256"], PHASE_1F_A23_APPROVAL_COMMAND_SHA256)
        self.assertEqual(set(manifest["gateway_binding_approved_file_scope"].split(",")), PHASE_1F_VERSIONED_GATEWAY_BINDING_FILE_ALLOWLIST)

    def test_phase_1f_gateway_binding_is_disabled_by_default_and_binds_nothing(self):
        decision = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_GATEWAY_BINDING_DISABLED")
        self.assertFalse(decision.gateway_bound)
        self.assertFalse(decision.gateway_runtime_mutated)
        self.assertFalse(decision.web_server_changed)
        self.assertFalse(decision.profile_worker_wired)
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.runtime_bound)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.model_call_performed)
        self.assertFalse(decision.credentials_materialized)

    def test_phase_1f_gateway_binding_prepares_secret_free_manifest_without_gateway_binding(self):
        decision = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_GATEWAY_BINDING_CONTRACT_READY_NO_GATEWAY_BOUND")
        self.assertTrue(decision.implementation_scope_decision.allowed)
        self.assertEqual(decision.versioned_wiring_decision.reason, "PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_CONTRACT_READY_NO_GATEWAY_WIRED")
        self.assertEqual(decision.base_gateway_binding_decision.reason, "GATEWAY_BINDING_CONTRACT_READY_NO_GATEWAY_BOUND")
        self.assertEqual(decision.gateway_binding_manifest["phase"], "1F-A24")
        self.assertEqual(decision.gateway_binding_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.gateway_binding_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(decision.gateway_binding_manifest["gateway_binding_policy_id"], "gateway-binding-policy-v1")
        self.assertEqual(decision.gateway_binding_manifest["binding_state"], "versioned_disabled_contract_ready_no_gateway_bound")
        self.assertNotIn("api_key", str(decision.gateway_binding_manifest).lower())
        self.assertNotIn("token", str(decision.gateway_binding_manifest).lower())
        self.assertFalse(decision.gateway_bound)
        self.assertFalse(decision.profile_worker_wired)
        self.assertFalse(decision.runtime_started)

    def test_phase_1f_gateway_binding_rejects_missing_scope_bad_scope_mismatch_and_bad_version(self):
        missing_scope = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(implementation_scope_attestation=None),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        bad_scope = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(implementation_scope_attestation=gateway_scope_attestation(changed_files=("web_server.py",))),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        mismatch = prepare_phase_1f_versioned_gateway_binding(
            request=Phase1FVersionedGatewayBindingRequest(
                base_gateway_binding_request=gateway_binding_request(wiring_request=base_wiring_request(execution_request=execution_request(expected_profile_id="dev-director"))),
                versioned_wiring_request=Phase1FVersionedHostRuntimeWiringRequest(
                    base_wiring_request=base_wiring_request(execution_request=execution_request(expected_profile_id="content-director")),
                    versioned_execution_request=versioned_execution_request(base_execution_request=execution_request(expected_profile_id="content-director")),
                    implementation_scope_attestation=wiring_scope_attestation(),
                ),
                implementation_scope_attestation=gateway_scope_attestation(),
            ),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        bad_version = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(expected_gateway_binding_contract_version=""),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(missing_scope.reason, "GATEWAY_BINDING_IMPLEMENTATION_SCOPE_ATTESTATION_MISSING")
        self.assertEqual(bad_scope.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:web_server.py")
        self.assertEqual(mismatch.reason, "VERSIONED_WIRING_REQUEST_MISMATCH")
        self.assertEqual(bad_version.reason, "EXPECTED_GATEWAY_BINDING_CONTRACT_VERSION_MISSING")

    def test_phase_1f_gateway_binding_rejects_gateway_profile_worker_runtime_flags_and_propagates_fail_closed(self):
        for kwargs, reason in (
            ({"gateway_py_binding_enabled": True}, "GATEWAY_PY_BINDING_OUT_OF_SCOPE"),
            ({"web_server_py_binding_enabled": True}, "WEB_SERVER_PY_BINDING_OUT_OF_SCOPE"),
            ({"gateway_runtime_mutation_enabled": True}, "GATEWAY_RUNTIME_MUTATION_OUT_OF_SCOPE"),
            ({"profile_worker_wiring_enabled": True}, "PROFILE_WORKER_WIRING_OUT_OF_SCOPE"),
            ({"hermes_core_binding_enabled": True}, "HERMES_CORE_BINDING_OUT_OF_SCOPE"),
            ({"dependency_changes_enabled": True}, "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
            ({"runtime_process_launch_enabled": True}, "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
            ({"runtime_binding_enabled": True}, "RUNTIME_BINDING_OUT_OF_SCOPE"),
            ({"profile_runtime_execution_enabled": True}, "PROFILE_RUNTIME_EXECUTION_OUT_OF_SCOPE"),
            ({"subprocess_launch_enabled": True}, "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
            ({"sandbox_creation_enabled": True}, "SANDBOX_CREATION_OUT_OF_SCOPE"),
            ({"provider_model_api_enabled": True}, "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
            ({"credential_materialization_enabled": True}, "CREDENTIAL_MATERIALIZATION_OUT_OF_SCOPE"),
        ):
            decision = prepare_phase_1f_versioned_gateway_binding(
                request=phase1f_gateway_request(),
                config=enabled_config(**kwargs),
                audit_sink=AuditSinkState(True),
                broker_available=True,
            )
            self.assertEqual(decision.reason, reason)

        audit_denied = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_wiring_denied = prepare_phase_1f_versioned_gateway_binding(
            request=phase1f_gateway_request(),
            config=enabled_config(wiring_contract_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_wiring_denied.reason, "PHASE_1F_VERSIONED_HOST_RUNTIME_WIRING_DISABLED")


if __name__ == "__main__":
    unittest.main()
