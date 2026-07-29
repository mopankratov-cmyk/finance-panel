import unittest

from tools.pankster_runtime_security.runtime_integration_phase1f_contracts import (
    PHASE_1F_A5R_APPROVAL_COMMAND_SHA256,
    PHASE_1F_VERSIONED_FILE_ALLOWLIST,
    Phase1FVersionedImplementationScopeAttestation,
    phase_1f_versioned_scope_manifest,
    validate_phase_1f_versioned_implementation_scope,
)


def attestation(**overrides):
    values = {
        "owner_approval_command_sha256": PHASE_1F_A5R_APPROVAL_COMMAND_SHA256,
        "changed_files": (
            "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
            "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
        ),
    }
    values.update(overrides)
    return Phase1FVersionedImplementationScopeAttestation(**values)


class PanksterRuntimeSecurityRuntimeIntegrationPhase1FContractTests(unittest.TestCase):
    def test_phase_1f_versioned_scope_accepts_only_new_allowlisted_files(self):
        decision = validate_phase_1f_versioned_implementation_scope(attestation())

        self.assertTrue(decision.allowed)
        self.assertEqual(decision.reason, "PHASE_1F_VERSIONED_PURE_CONTRACT_SCOPE_ACCEPTED_NO_RUNTIME")
        self.assertEqual(
            decision.approved_file_scope,
            (
                "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
                "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
            ),
        )
        self.assertFalse(decision.runtime_started)
        self.assertFalse(decision.subprocess_started)
        self.assertFalse(decision.sandbox_started)
        self.assertFalse(decision.provider_call_performed)
        self.assertFalse(decision.credentials_materialized)

    def test_phase_1f_versioned_scope_rejects_bad_approval_duplicate_and_empty_scope(self):
        bad_approval = validate_phase_1f_versioned_implementation_scope(attestation(owner_approval_command_sha256="bad"))
        duplicate = validate_phase_1f_versioned_implementation_scope(
            attestation(
                changed_files=(
                    "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
                    "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
                )
            )
        )
        missing = validate_phase_1f_versioned_implementation_scope(attestation(changed_files=()))

        self.assertEqual(bad_approval.reason, "OWNER_APPROVAL_HASH_MISMATCH")
        self.assertEqual(duplicate.reason, "IMPLEMENTATION_FILE_DUPLICATE")
        self.assertEqual(missing.reason, "IMPLEMENTATION_FILES_MISSING")

    def test_phase_1f_versioned_scope_rejects_phase_1e_hash_pinned_and_unknown_files(self):
        pinned = validate_phase_1f_versioned_implementation_scope(
            attestation(changed_files=("tools/pankster_runtime_security/runtime_integration_contracts.py",))
        )
        unknown = validate_phase_1f_versioned_implementation_scope(attestation(changed_files=("gateway.py",)))

        self.assertEqual(
            pinned.reason,
            "PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:tools/pankster_runtime_security/runtime_integration_contracts.py",
        )
        self.assertEqual(unknown.reason, "IMPLEMENTATION_FILE_OUT_OF_SCOPE:gateway.py")

    def test_phase_1f_versioned_scope_rejects_runtime_credentials_api_and_deploy_flags(self):
        for flag in (
            "runtime_execution_requested",
            "subprocess_launch_requested",
            "sandbox_launch_requested",
            "provider_api_call_requested",
            "model_api_call_requested",
            "real_credentials_requested",
            "auth_store_read_requested",
            "oauth_refresh_requested",
            "gateway_change_requested",
            "web_server_change_requested",
            "hermes_core_change_requested",
            "dependency_change_requested",
            "production_profile_requested",
            "canary_requested",
            "deployment_requested",
            "phase_1e_hash_pinned_file_change_requested",
        ):
            decision = validate_phase_1f_versioned_implementation_scope(attestation(**{flag: True}))

            self.assertFalse(decision.allowed)
            self.assertEqual(decision.reason, f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{flag}")

    def test_phase_1f_versioned_manifest_contains_no_secret_or_runtime_state(self):
        manifest = phase_1f_versioned_scope_manifest(attestation())

        self.assertEqual(manifest["allowed"], "true")
        self.assertEqual(manifest["approval_command_sha256"], PHASE_1F_A5R_APPROVAL_COMMAND_SHA256)
        self.assertEqual(set(manifest["approved_file_scope"].split(",")), set(attestation().changed_files))
        self.assertEqual(PHASE_1F_VERSIONED_FILE_ALLOWLIST, frozenset(manifest["approved_file_scope"].split(",")) | (PHASE_1F_VERSIONED_FILE_ALLOWLIST - set(attestation().changed_files)))


if __name__ == "__main__":
    unittest.main()
