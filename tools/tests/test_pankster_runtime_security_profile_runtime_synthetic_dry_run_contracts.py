import unittest

from tools.pankster_runtime_security.audit_contracts import AuditSinkState
from tools.pankster_runtime_security.profile_runtime_synthetic_dry_run_contracts import (
    REQUIRED_PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_CAPABILITIES,
    ProfileRuntimeSyntheticDryRunConfig,
    ProfileRuntimeSyntheticDryRunIdentity,
    ProfileRuntimeSyntheticDryRunRequest,
    prepare_profile_runtime_synthetic_dry_run,
)
from tools.tests.test_pankster_runtime_security_profile_runtime_synthetic_invocation_contracts import (
    profile_runtime_synthetic_invocation_request,
)


def profile_runtime_synthetic_dry_run_identity(**overrides):
    values = {
        "synthetic_dry_run_name": "local-disabled-profile-runtime-synthetic-dry-run",
        "synthetic_dry_run_version": "1",
        "synthetic_dry_run_contract_version": "phase-1e-a45",
        "capabilities": tuple(sorted(REQUIRED_PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_CAPABILITIES)),
    }
    values.update(overrides)
    return ProfileRuntimeSyntheticDryRunIdentity(**values)


def profile_runtime_synthetic_dry_run_request(**overrides):
    values = {
        "synthetic_dry_run_identity": profile_runtime_synthetic_dry_run_identity(),
        "profile_runtime_synthetic_invocation_request": profile_runtime_synthetic_invocation_request(),
        "expected_profile_id": "dev-director",
        "expected_policy_version": "policy-v1",
        "expected_runtime_backend": "disabled-local-contract",
        "expected_rollback_policy_id": "rollback-policy-v1",
        "expected_wiring_policy_id": "wiring-policy-v1",
        "expected_gateway_binding_policy_id": "gateway-binding-policy-v1",
        "expected_profile_worker_binding_policy_id": "profile-worker-binding-policy-v1",
        "expected_profile_runtime_activation_policy_id": "profile-runtime-activation-policy-v1",
        "expected_profile_runtime_activation_execution_policy_id": "profile-runtime-activation-execution-policy-v1",
        "expected_profile_runtime_invocation_policy_id": "profile-runtime-invocation-policy-v1",
        "expected_profile_runtime_synthetic_invocation_policy_id": "profile-runtime-synthetic-invocation-policy-v1",
        "profile_runtime_synthetic_dry_run_policy_id": "profile-runtime-synthetic-dry-run-policy-v1",
    }
    values.update(overrides)
    return ProfileRuntimeSyntheticDryRunRequest(**values)


def enabled_config(**overrides):
    values = {
        "profile_runtime_synthetic_dry_run_contract_enabled": True,
        "profile_runtime_synthetic_invocation_contract_enabled": True,
        "profile_runtime_invocation_contract_enabled": True,
        "profile_runtime_activation_execution_contract_enabled": True,
        "profile_runtime_activation_contract_enabled": True,
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
    return ProfileRuntimeSyntheticDryRunConfig(**values)


class PanksterRuntimeSecurityProfileRuntimeSyntheticDryRunContractTests(unittest.TestCase):
    def test_default_profile_runtime_synthetic_dry_run_is_disabled_and_starts_nothing(self):
        decision = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_DISABLED")
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.profile_started)
        self.assertFalse(decision.activation_executed)
        self.assertFalse(decision.invocation_performed)
        self.assertFalse(decision.synthetic_invocation_performed)
        self.assertFalse(decision.synthetic_dry_run_performed)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.model_call_performed)
        self.assertFalse(decision.credentials_materialized)
        self.assertFalse(decision.oauth_refresh_performed)
        self.assertFalse(decision.profile_worker_changed)
        self.assertFalse(decision.gateway_changed)
        self.assertFalse(decision.web_server_changed)
        self.assertFalse(decision.hermes_core_changed)
        self.assertFalse(decision.dependency_changed)

    def test_enabled_profile_runtime_synthetic_dry_run_prepares_secret_free_manifest_without_dry_run(self):
        decision = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(
            decision.reason,
            "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_CONTRACT_READY_NO_SYNTHETIC_DRY_RUN_PERFORMED",
        )
        self.assertEqual(
            decision.profile_runtime_synthetic_invocation_decision.reason,
            "PROFILE_RUNTIME_SYNTHETIC_INVOCATION_CONTRACT_READY_NO_SYNTHETIC_INVOCATION_PERFORMED",
        )
        self.assertEqual(decision.profile_runtime_synthetic_dry_run_manifest["profile_id"], "dev-director")
        self.assertEqual(decision.profile_runtime_synthetic_dry_run_manifest["runtime_backend"], "disabled-local-contract")
        self.assertEqual(
            decision.profile_runtime_synthetic_dry_run_manifest["profile_runtime_synthetic_dry_run_policy_id"],
            "profile-runtime-synthetic-dry-run-policy-v1",
        )
        self.assertEqual(
            decision.profile_runtime_synthetic_dry_run_manifest["profile_runtime_synthetic_dry_run_state"],
            "disabled_contract_ready_no_synthetic_dry_run_performed",
        )
        self.assertNotIn("credential", str(decision.profile_runtime_synthetic_dry_run_manifest).lower())
        self.assertFalse(decision.profile_started)
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.activation_executed)
        self.assertFalse(decision.invocation_performed)
        self.assertFalse(decision.synthetic_invocation_performed)
        self.assertFalse(decision.synthetic_dry_run_performed)

    def test_profile_runtime_synthetic_dry_run_rejects_out_of_scope_runtime_flags(self):
        cases = [
            ("profile_runtime_synthetic_dry_run_enabled", "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_OUT_OF_SCOPE"),
            ("profile_runtime_synthetic_invocation_enabled", "PROFILE_RUNTIME_SYNTHETIC_INVOCATION_OUT_OF_SCOPE"),
            ("profile_runtime_invocation_enabled", "PROFILE_RUNTIME_INVOCATION_OUT_OF_SCOPE"),
            ("profile_runtime_activation_execution_enabled", "PROFILE_RUNTIME_ACTIVATION_EXECUTION_OUT_OF_SCOPE"),
            ("profile_runtime_activation_enabled", "PROFILE_RUNTIME_ACTIVATION_OUT_OF_SCOPE"),
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
            ("oauth_refresh_enabled", "OAUTH_REFRESH_OUT_OF_SCOPE"),
        ]
        for flag, reason in cases:
            with self.subTest(flag=flag):
                decision = prepare_profile_runtime_synthetic_dry_run(
                    request=profile_runtime_synthetic_dry_run_request(),
                    config=enabled_config(**{flag: True}),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_profile_runtime_synthetic_dry_run_requires_identity_capabilities(self):
        missing_name = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(
                synthetic_dry_run_identity=profile_runtime_synthetic_dry_run_identity(synthetic_dry_run_name="")
            ),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )
        missing_capability = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(
                synthetic_dry_run_identity=profile_runtime_synthetic_dry_run_identity(capabilities=("fail_closed",))
            ),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(
            missing_name.reason,
            "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_IDENTITY_FIELD_MISSING:synthetic_dry_run_name",
        )
        self.assertTrue(missing_capability.reason.startswith("PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_CAPABILITY_MISSING:"))

    def test_profile_runtime_synthetic_dry_run_revalidates_profile_policy_backend_and_synthetic_ids(self):
        cases = [
            ({"expected_profile_id": "content-director"}, "EXPECTED_PROFILE_MISMATCH"),
            ({"expected_policy_version": "policy-v2"}, "EXPECTED_POLICY_VERSION_MISMATCH"),
            ({"expected_runtime_backend": "other-backend"}, "EXPECTED_RUNTIME_BACKEND_MISMATCH"),
            ({"expected_rollback_policy_id": "other-rollback"}, "EXPECTED_ROLLBACK_POLICY_MISMATCH"),
            ({"expected_wiring_policy_id": "other-wiring"}, "EXPECTED_WIRING_POLICY_MISMATCH"),
            ({"expected_gateway_binding_policy_id": "other-gateway-binding"}, "EXPECTED_GATEWAY_BINDING_POLICY_MISMATCH"),
            (
                {"expected_profile_worker_binding_policy_id": "other-profile-worker-binding"},
                "EXPECTED_PROFILE_WORKER_BINDING_POLICY_MISMATCH",
            ),
            (
                {"expected_profile_runtime_activation_policy_id": "other-profile-runtime-activation"},
                "EXPECTED_PROFILE_RUNTIME_ACTIVATION_POLICY_MISMATCH",
            ),
            (
                {"expected_profile_runtime_activation_execution_policy_id": "other-activation-execution"},
                "EXPECTED_PROFILE_RUNTIME_ACTIVATION_EXECUTION_POLICY_MISMATCH",
            ),
            (
                {"expected_profile_runtime_invocation_policy_id": "other-invocation"},
                "EXPECTED_PROFILE_RUNTIME_INVOCATION_POLICY_MISMATCH",
            ),
            (
                {"expected_profile_runtime_synthetic_invocation_policy_id": "other-synthetic-invocation"},
                "EXPECTED_PROFILE_RUNTIME_SYNTHETIC_INVOCATION_POLICY_MISMATCH",
            ),
            ({"profile_runtime_synthetic_dry_run_policy_id": ""}, "PROFILE_RUNTIME_SYNTHETIC_DRY_RUN_POLICY_MISSING"),
        ]
        for overrides, reason in cases:
            with self.subTest(reason=reason):
                decision = prepare_profile_runtime_synthetic_dry_run(
                    request=profile_runtime_synthetic_dry_run_request(**overrides),
                    config=enabled_config(),
                    audit_sink=AuditSinkState(True),
                    broker_available=True,
                )
                self.assertEqual(decision.reason, reason)

    def test_profile_runtime_synthetic_dry_run_propagates_synthetic_invocation_fail_closed_reasons(self):
        audit_denied = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(False),
            broker_available=True,
        )
        broker_denied = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(),
            config=enabled_config(),
            audit_sink=AuditSinkState(True),
            broker_available=False,
        )
        disabled_synthetic_denied = prepare_profile_runtime_synthetic_dry_run(
            request=profile_runtime_synthetic_dry_run_request(),
            config=enabled_config(profile_runtime_synthetic_invocation_contract_enabled=False),
            audit_sink=AuditSinkState(True),
            broker_available=True,
        )

        self.assertEqual(audit_denied.reason, "AUDIT_UNAVAILABLE")
        self.assertEqual(broker_denied.reason, "BROKER_UNAVAILABLE")
        self.assertEqual(disabled_synthetic_denied.reason, "PROFILE_RUNTIME_SYNTHETIC_INVOCATION_DISABLED")


if __name__ == "__main__":
    unittest.main()
