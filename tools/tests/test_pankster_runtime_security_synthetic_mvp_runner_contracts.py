import unittest
from pathlib import Path

from tools.pankster_runtime_security.synthetic_mvp_runner_contracts import (
    PHASE_2_A0_APPROVAL_COMMAND,
    PHASE_2_A0_APPROVAL_COMMAND_SHA256,
    SyntheticMvpConfig,
    SyntheticMvpProfile,
    SyntheticMvpRequest,
    SyntheticMvpSurfacePolicy,
    run_synthetic_mvp,
)
from tools.pankster_runtime_security.secret_scan import scan_secret_shapes


def synthetic_profile(**overrides):
    values = {
        "profile_id": "synthetic-dev-director",
        "workflow_id": "synthetic-workflow",
        "policy_version": "phase-2-a1",
        "runtime_backend": "synthetic-only-mvp",
        "runtime_identity_hash": "runtime_identity_hash_synthetic_a1",
        "synthetic_only": True,
        "provider_family": "synthetic-compatible",
        "model_allowlist": ("kimi-k2-cheap", "deepseek-v3-cheap"),
        "operation_allowlist": ("complete",),
    }
    values.update(overrides)
    return SyntheticMvpProfile(**values)


def synthetic_request(**overrides):
    values = {
        "owner_approval_command": PHASE_2_A0_APPROVAL_COMMAND,
        "profile": synthetic_profile(),
        "task_id": "synthetic-task-001",
        "attempt_id": "synthetic-attempt-001",
        "sequence_id": "synthetic-sequence-001",
        "purpose": "synthetic-proof",
        "operation": "complete",
        "model": "kimi-k2-cheap",
        "input_payload": "synthetic prompt with no credential material",
        "source_environment": {
            "PATH": "/usr/bin:/bin",
            "HOME": "/tmp/pankster-synthetic-home",
            "TMPDIR": "/tmp",
            "LANG": "C.UTF-8",
            "SHELL": "/bin/zsh",
            "NO_PROXY": "localhost,127.0.0.1",
            "no_proxy": "localhost,127.0.0.1",
            "PANKSTER_PROFILE_ID": "synthetic-dev-director",
            "PANKSTER_TASK_ID": "synthetic-task-001",
            "PANKSTER_ATTEMPT_ID": "synthetic-attempt-001",
            "UNLISTED_LABEL": "ignored",
        },
    }
    values.update(overrides)
    return SyntheticMvpRequest(**values)


def enabled_config(**overrides):
    values = {"synthetic_mvp_enabled": True}
    values.update(overrides)
    return SyntheticMvpConfig(**values)


class PanksterRuntimeSecuritySyntheticMvpRunnerContractTests(unittest.TestCase):
    def test_default_config_is_disabled_and_starts_nothing(self):
        decision = run_synthetic_mvp(request=synthetic_request())

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SYNTHETIC_MVP_DISABLED")
        self.assertFalse(decision.gateway_started)
        self.assertFalse(decision.profile_started)
        self.assertFalse(decision.profile_runtime_executed)
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.network_call_performed)
        self.assertFalse(decision.real_credentials_materialized)
        self.assertFalse(decision.oauth_refresh_performed)

    def test_approved_synthetic_mvp_returns_secret_free_manifest(self):
        decision = run_synthetic_mvp(request=synthetic_request(), config=enabled_config())

        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason, "SYNTHETIC_MVP_COMPLETED_SYNTHETIC_ONLY")
        self.assertIsNotNone(decision.manifest)
        self.assertIsNotNone(decision.fake_model_payload)
        manifest = decision.manifest or {}
        self.assertEqual(manifest["status"], "PHASE_2_A1_SYNTHETIC_MVP_IMPLEMENTATION_COMPLETE_SYNTHETIC_ONLY")
        self.assertEqual(manifest["approval_command_sha256"], PHASE_2_A0_APPROVAL_COMMAND_SHA256)
        self.assertEqual(manifest["profile_id"], "synthetic-dev-director")
        self.assertEqual(manifest["runtime_backend"], "synthetic-only-mvp")
        self.assertTrue(manifest["fake_credentials_only"])
        self.assertTrue(manifest["fake_model_broker_only"])
        self.assertFalse(manifest["real_credentials_materialized"])
        self.assertFalse(manifest["provider_api_calls_performed"])
        self.assertFalse(manifest["model_api_calls_performed"])
        self.assertFalse(manifest["network_calls_performed"])
        self.assertFalse(manifest["runtime_process_started"])
        self.assertFalse(manifest["subprocess_started"])
        self.assertFalse(manifest["sandbox_started"])
        self.assertFalse(manifest["gateway_started"])
        self.assertFalse(manifest["profile_started"])
        self.assertFalse(manifest["profile_runtime_executed"])
        self.assertFalse(manifest["auth_files_read"])
        self.assertFalse(manifest["keychain_read"])
        self.assertFalse(manifest["oauth_refresh_performed"])
        self.assertTrue(scan_secret_shapes(manifest).allowed)

    def test_sanitized_environment_preserves_no_proxy_and_drops_unallowlisted_keys(self):
        decision = run_synthetic_mvp(request=synthetic_request(), config=enabled_config())

        self.assertTrue(decision.allowed)
        self.assertIsNotNone(decision.sanitized_environment)
        sanitized = decision.sanitized_environment
        assert sanitized is not None
        self.assertEqual(sanitized.env["NO_PROXY"], "localhost,127.0.0.1")
        self.assertEqual(sanitized.env["no_proxy"], "localhost,127.0.0.1")
        self.assertNotIn("UNLISTED_LABEL", sanitized.env)
        self.assertIn("UNLISTED_LABEL", sanitized.ignored_keys)
        for surface in decision.surface_results:
            self.assertEqual(surface.sanitized_environment["NO_PROXY"], "localhost,127.0.0.1")
            self.assertNotIn("UNLISTED_LABEL", surface.sanitized_environment)

    def test_sensitive_environment_keys_fail_closed_without_printing_values(self):
        request = synthetic_request(
            source_environment={
                "PATH": "/usr/bin:/bin",
                "HOME": "/tmp/pankster-synthetic-home",
                "TMPDIR": "/tmp",
                "LANG": "C.UTF-8",
                "SHELL": "/bin/zsh",
                "TELEGRAM_TOKEN": "synthetic-token-shape-never-returned",
            }
        )
        decision = run_synthetic_mvp(request=request, config=enabled_config())

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SOURCE_ENVIRONMENT_DENIED_KEYS_PRESENT")
        self.assertIsNotNone(decision.sanitized_environment)
        sanitized = decision.sanitized_environment
        assert sanitized is not None
        self.assertEqual(sanitized.denied_keys, ("TELEGRAM_TOKEN",))
        self.assertNotIn("synthetic-token-shape-never-returned", str(decision))

    def test_secret_shaped_allowlisted_environment_value_fails_closed(self):
        request = synthetic_request(
            source_environment={
                "PATH": "Bearer abcdefghijklmnopqrstuvwxyz123456",
                "HOME": "/tmp/pankster-synthetic-home",
                "TMPDIR": "/tmp",
                "LANG": "C.UTF-8",
                "SHELL": "/bin/zsh",
            }
        )
        decision = run_synthetic_mvp(request=request, config=enabled_config())

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SANITIZED_ENVIRONMENT_SECRET_SCAN_FAILED")

    def test_owner_approval_must_match_exact_token(self):
        decision = run_synthetic_mvp(
            request=synthetic_request(owner_approval_command=PHASE_2_A0_APPROVAL_COMMAND + "-tampered"),
            config=enabled_config(),
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "OWNER_APPROVAL_COMMAND_MISMATCH")

    def test_rejects_non_synthetic_profile_and_wrong_backend(self):
        non_synthetic = run_synthetic_mvp(
            request=synthetic_request(profile=synthetic_profile(synthetic_only=False)),
            config=enabled_config(),
        )
        wrong_backend = run_synthetic_mvp(
            request=synthetic_request(profile=synthetic_profile(runtime_backend="local-runtime")),
            config=enabled_config(),
        )

        self.assertEqual(non_synthetic.reason, "PROFILE_NOT_SYNTHETIC")
        self.assertEqual(wrong_backend.reason, "RUNTIME_BACKEND_NOT_SYNTHETIC_MVP")

    def test_rejects_model_and_operation_outside_profile_allowlist(self):
        bad_model = run_synthetic_mvp(request=synthetic_request(model="live-provider-model"), config=enabled_config())
        bad_operation = run_synthetic_mvp(request=synthetic_request(operation="stream"), config=enabled_config())

        self.assertEqual(bad_model.reason, "MODEL_NOT_ALLOWLISTED")
        self.assertEqual(bad_operation.reason, "OPERATION_NOT_ALLOWLISTED")

    def test_surfaces_are_fake_or_fail_closed_only(self):
        decision = run_synthetic_mvp(
            request=synthetic_request(
                surface_policy=SyntheticMvpSurfacePolicy(
                    terminal="fake",
                    code_execution="fake",
                    delegate_task="fail_closed",
                    mcp="fail_closed",
                )
            ),
            config=enabled_config(),
        )

        self.assertTrue(decision.allowed)
        self.assertEqual(
            {surface.name: surface.mode for surface in decision.surface_results},
            {
                "terminal": "fake",
                "code_execution": "fake",
                "delegate_task": "fail_closed",
                "mcp": "fail_closed",
            },
        )

    def test_invalid_surface_mode_fails_closed_before_model_broker(self):
        decision = run_synthetic_mvp(
            request=synthetic_request(surface_policy=SyntheticMvpSurfacePolicy(terminal="real")),
            config=enabled_config(),
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SURFACE_MODE_INVALID:terminal")
        self.assertIsNone(decision.fake_model_payload)

    def test_out_of_scope_runtime_and_credential_flags_are_denied(self):
        cases = [
            ("gateway_start_enabled", "GATEWAY_START_OUT_OF_SCOPE"),
            ("production_profiles_enabled", "PRODUCTION_PROFILES_OUT_OF_SCOPE"),
            ("profile_runtime_execution_enabled", "PROFILE_RUNTIME_EXECUTION_OUT_OF_SCOPE"),
            ("profile_start_enabled", "PROFILE_START_OUT_OF_SCOPE"),
            ("real_credentials_enabled", "REAL_CREDENTIALS_OUT_OF_SCOPE"),
            ("auth_file_reads_enabled", "AUTH_FILE_READS_OUT_OF_SCOPE"),
            ("keychain_reads_enabled", "KEYCHAIN_READS_OUT_OF_SCOPE"),
            ("oauth_refresh_enabled", "OAUTH_REFRESH_OUT_OF_SCOPE"),
            ("provider_model_api_enabled", "PROVIDER_MODEL_API_OUT_OF_SCOPE"),
            ("network_calls_enabled", "NETWORK_CALLS_OUT_OF_SCOPE"),
            ("runtime_process_launch_enabled", "RUNTIME_PROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("subprocess_launch_enabled", "SUBPROCESS_LAUNCH_OUT_OF_SCOPE"),
            ("sandbox_creation_enabled", "SANDBOX_CREATION_OUT_OF_SCOPE"),
            ("dependency_changes_enabled", "DEPENDENCY_CHANGES_OUT_OF_SCOPE"),
            ("deployment_enabled", "DEPLOYMENT_OUT_OF_SCOPE"),
            ("canary_enabled", "CANARY_OUT_OF_SCOPE"),
        ]
        for flag, reason in cases:
            with self.subTest(flag=flag):
                decision = run_synthetic_mvp(
                    request=synthetic_request(),
                    config=enabled_config(**{flag: True}),
                )
                self.assertFalse(decision.allowed)
                self.assertEqual(decision.reason, reason)

    def test_request_secret_shape_fails_closed(self):
        decision = run_synthetic_mvp(
            request=synthetic_request(input_payload="Bearer abcdefghijklmnopqrstuvwxyz123456"),
            config=enabled_config(),
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "SYNTHETIC_MVP_REQUEST_SECRET_SCAN_FAILED")

    def test_source_does_not_import_runtime_network_or_process_modules(self):
        source = Path("tools/pankster_runtime_security/synthetic_mvp_runner_contracts.py").read_text(encoding="utf-8")

        forbidden_modules = (
            "os",
            "sub" + "process",
            "sock" + "et",
            "req" + "uests",
            "url" + "lib",
            "http" + "x",
            "op" + "enai",
            "anth" + "ropic",
            "e" + "2b",
        )
        for module in forbidden_modules:
            with self.subTest(module=module):
                self.assertNotIn(f"import {module}", source)


if __name__ == "__main__":
    unittest.main()
