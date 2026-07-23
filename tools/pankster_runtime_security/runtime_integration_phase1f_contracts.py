"""Versioned Phase 1F runtime integration contracts.

This module is a pure contract layer. It does not import Hermes runtime code,
start subprocesses, create sandboxes, call network/provider APIs, read process
environment, read auth files, access Keychain, refresh OAuth, or materialize
credentials.
"""

from __future__ import annotations

from dataclasses import dataclass


PHASE_1F_A5R_APPROVAL_COMMAND_SHA256 = "51ee3b2dee1694ffada7ee9bd20391251f3b73a5fda6d79724b2f16c7bfd9ec4"
PHASE_1F_VERSIONED_IMPLEMENTATION_MODE = "versioned_pure_contract_layer"
PHASE_1F_VERSIONED_FILE_ALLOWLIST = frozenset(
    {
        "tools/pankster_runtime_security/runtime_integration_phase1f_contracts.py",
        "tools/pankster_runtime_security/runtime_adapter_binding_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_integration_phase1f_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_phase1f_contracts.py",
    }
)
PHASE_1F_HASH_PINNED_PHASE_1E_FILES = frozenset(
    {
        "tools/pankster_runtime_security/runtime_integration_contracts.py",
        "tools/pankster_runtime_security/runtime_adapter_binding_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_integration_contracts.py",
        "tools/tests/test_pankster_runtime_security_runtime_adapter_binding_contracts.py",
    }
)


@dataclass(frozen=True)
class Phase1FVersionedImplementationScopeAttestation:
    """Owner-approved Phase 1F versioned implementation boundary."""

    owner_approval_command_sha256: str
    changed_files: tuple[str, ...]
    implementation_mode: str = PHASE_1F_VERSIONED_IMPLEMENTATION_MODE
    runtime_execution_requested: bool = False
    subprocess_launch_requested: bool = False
    sandbox_launch_requested: bool = False
    provider_api_call_requested: bool = False
    model_api_call_requested: bool = False
    real_credentials_requested: bool = False
    auth_store_read_requested: bool = False
    oauth_refresh_requested: bool = False
    gateway_change_requested: bool = False
    web_server_change_requested: bool = False
    hermes_core_change_requested: bool = False
    dependency_change_requested: bool = False
    production_profile_requested: bool = False
    canary_requested: bool = False
    deployment_requested: bool = False
    phase_1e_hash_pinned_file_change_requested: bool = False


@dataclass(frozen=True)
class Phase1FVersionedImplementationScopeDecision:
    allowed: bool
    reason: str
    approved_file_scope: tuple[str, ...] = ()
    runtime_started: bool = False
    subprocess_started: bool = False
    sandbox_started: bool = False
    provider_call_performed: bool = False
    credentials_materialized: bool = False
    gateway_changed: bool = False
    web_server_changed: bool = False
    hermes_core_changed: bool = False
    dependencies_changed: bool = False
    production_profile_touched: bool = False


def validate_phase_1f_versioned_implementation_scope(
    attestation: Phase1FVersionedImplementationScopeAttestation,
) -> Phase1FVersionedImplementationScopeDecision:
    """Validate the Phase 1F-A6 versioned pure-contract implementation scope."""

    if attestation.owner_approval_command_sha256 != PHASE_1F_A5R_APPROVAL_COMMAND_SHA256:
        return _deny("OWNER_APPROVAL_HASH_MISMATCH")
    if attestation.implementation_mode != PHASE_1F_VERSIONED_IMPLEMENTATION_MODE:
        return _deny("IMPLEMENTATION_MODE_UNSUPPORTED")
    if not attestation.changed_files:
        return _deny("IMPLEMENTATION_FILES_MISSING")
    if len(set(attestation.changed_files)) != len(attestation.changed_files):
        return _deny("IMPLEMENTATION_FILE_DUPLICATE")
    forbidden_flag = _forbidden_scope_flag(attestation)
    if forbidden_flag is not None:
        return _deny(f"IMPLEMENTATION_SCOPE_FLAG_FORBIDDEN:{forbidden_flag}")
    for changed_file in attestation.changed_files:
        if changed_file in PHASE_1F_HASH_PINNED_PHASE_1E_FILES:
            return _deny(f"PHASE_1E_HASH_PINNED_FILE_FORBIDDEN:{changed_file}")
        if changed_file not in PHASE_1F_VERSIONED_FILE_ALLOWLIST:
            return _deny(f"IMPLEMENTATION_FILE_OUT_OF_SCOPE:{changed_file}")
    return Phase1FVersionedImplementationScopeDecision(
        allowed=True,
        reason="PHASE_1F_VERSIONED_PURE_CONTRACT_SCOPE_ACCEPTED_NO_RUNTIME",
        approved_file_scope=tuple(sorted(attestation.changed_files)),
    )


def phase_1f_versioned_scope_manifest(
    attestation: Phase1FVersionedImplementationScopeAttestation,
) -> dict[str, str]:
    """Return a non-secret manifest for an already accepted attestation."""

    decision = validate_phase_1f_versioned_implementation_scope(attestation)
    if not decision.allowed:
        return {
            "allowed": "false",
            "reason": decision.reason,
        }
    return {
        "allowed": "true",
        "reason": decision.reason,
        "implementation_mode": attestation.implementation_mode,
        "approval_command_sha256": attestation.owner_approval_command_sha256,
        "approved_file_scope": ",".join(decision.approved_file_scope),
    }


def _deny(reason: str) -> Phase1FVersionedImplementationScopeDecision:
    return Phase1FVersionedImplementationScopeDecision(False, reason)


def _forbidden_scope_flag(attestation: Phase1FVersionedImplementationScopeAttestation) -> str | None:
    for field in (
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
        if getattr(attestation, field):
            return field
    return None
