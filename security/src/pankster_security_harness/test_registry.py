"""Security test ID registry and baseline result collection."""

from __future__ import annotations

import re
from collections import Counter

from .baseline import BaselineResult

SEC_ID_RE = re.compile(r"^SEC-(?:BL|PROT|ISO)-[0-9]{3}$")
TEST_IDENTITY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\.test_[A-Za-z0-9_]+$")


def test_identity(module: str, name: str) -> str:
    """Return the stable module-qualified identity for a function test."""

    return f"{module}.{name}"


TEST_ID_REGISTRY: dict[str, tuple[str, ...]] = {
    test_identity(
        "test_baseline_env_inheritance",
        "test_sec_bl_001_gateway_env_inheritance_characterizes_vulnerability",
    ): ("SEC-BL-001",),
    test_identity("test_root_fallback_fixture", "test_sec_bl_002_same_uid_can_read_synthetic_root_auth"): (
        "SEC-BL-002",
    ),
    test_identity("test_root_fallback_fixture", "test_sec_bl_003_root_credential_fallback_selects_root_provider"): (
        "SEC-BL-003",
    ),
    test_identity("test_context_propagation", "test_sec_bl_004_contextvar_loss_in_unwrapped_thread"): (
        "SEC-BL-004",
    ),
    test_identity("test_disabled_profile_gate", "test_sec_bl_005_disabled_profile_without_runtime_gate_is_insufficient"): (
        "SEC-BL-005",
    ),
    test_identity("test_no_proxy_preservation", "test_sec_bl_006_no_proxy_allowlists_are_inconsistent"): (
        "SEC-BL-006",
    ),
    test_identity("test_filesystem_isolation_probe", "test_sec_iso_001_backend_inventory_lists_required_options"): (
        "SEC-ISO-001",
    ),
    test_identity(
        "test_filesystem_isolation_probe",
        "test_sec_iso_002_filesystem_boundary_capability_is_not_claimed_from_presence_only",
    ): ("SEC-ISO-002",),
    test_identity("test_filesystem_isolation_probe", "test_sec_iso_003_network_boundary_requires_explicit_policy"): (
        "SEC-ISO-003",
    ),
    test_identity("test_filesystem_isolation_probe", "test_sec_iso_004_separate_identity_capability_is_reported"): (
        "SEC-ISO-004",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_001_allowlisted_environment_excludes_gateway_secret"): (
        "SEC-PROT-001",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_002_mandatory_denylist_applies_last_to_overrides"): (
        "SEC-PROT-002",
    ),
    test_identity("test_disabled_profile_gate", "test_sec_prot_003_runtime_enabled_fail_closed"): (
        "SEC-PROT-003",
    ),
    test_identity("test_patch_contracts", "test_sec_prot_004_policy_version_validation"): ("SEC-PROT-004",),
    test_identity("test_patch_contracts", "test_sec_prot_005_cwd_root_enforcement"): ("SEC-PROT-005",),
    test_identity("test_safe_env_policy", "test_sec_prot_006_no_proxy_and_lowercase_no_proxy_are_preserved"): (
        "SEC-PROT-006",
    ),
    test_identity("test_context_propagation", "test_sec_prot_007_008_009_010_context_propagation_wrappers"): (
        "SEC-PROT-007",
        "SEC-PROT-008",
        "SEC-PROT-009",
        "SEC-PROT-010",
    ),
    test_identity("test_log_redaction", "test_sec_prot_011_log_and_evidence_redaction_removes_sentinel"): (
        "SEC-PROT-011",
    ),
    test_identity("test_log_redaction", "test_sec_prot_012_no_secret_in_argv_snapshot"): ("SEC-PROT-012",),
    test_identity("test_patch_contracts", "test_sec_prot_013_immutable_runtime_security_context"): (
        "SEC-PROT-013",
    ),
    test_identity("test_patch_contracts", "test_sec_prot_014_sanitized_audit_event_contains_metadata_not_secrets"): (
        "SEC-PROT-014",
    ),
    test_identity("test_safe_spawn_happy_path", "test_sec_prot_015_safe_fixture_subprocess_happy_path"): (
        "SEC-PROT-015",
    ),
    test_identity("test_context_propagation", "test_sec_prot_016_no_context_bleed_across_reused_thread_workers"): (
        "SEC-PROT-016",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_017_explicit_kanban_env_list_rejects_wildcard_names"): (
        "SEC-PROT-017",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_018_profile_scoped_tmpdir_is_unique_per_profile_session"): (
        "SEC-PROT-018",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_019_reject_symlink_escape_for_profile_tmpdir"): (
        "SEC-PROT-019",
    ),
    test_identity("test_patch_contracts", "test_sec_prot_020_strict_grant_references"): ("SEC-PROT-020",),
    test_identity("test_log_redaction", "test_sec_prot_021_generic_evidence_detector"): ("SEC-PROT-021",),
    test_identity("test_evidence_pack", "test_sec_prot_022_evidence_pack_contains_no_values"): ("SEC-PROT-022",),
    test_identity("test_safe_env_policy", "test_sec_prot_023_reject_secret_shaped_allowed_env_value"): (
        "SEC-PROT-023",
    ),
    test_identity("test_log_redaction", "test_sec_prot_024_evidence_event_rejects_generic_secret_shape"): (
        "SEC-PROT-024",
    ),
    test_identity("test_log_redaction", "test_sec_prot_025_argv_snapshot_rejects_generic_secret_shape"): (
        "SEC-PROT-025",
    ),
    test_identity("test_log_redaction", "test_sec_prot_026_evidence_writer_rejects_generic_secret_shape"): (
        "SEC-PROT-026",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_027_tmpdir_traversal_rejected_without_side_effect"): (
        "SEC-PROT-027",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_028_context_can_deny_all_kanban_variables"): (
        "SEC-PROT-028",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_029_context_allows_only_selected_kanban_variables"): (
        "SEC-PROT-029",
    ),
    test_identity("test_safe_env_policy", "test_sec_prot_030_unknown_kanban_variable_denied"): ("SEC-PROT-030",),
    test_identity("test_generate_evidence", "test_sec_prot_031_evidence_summary_matches_actual_test_run_shape"): (
        "SEC-PROT-031",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_032_evidence_check_detects_stale_count"): (
        "SEC-PROT-032",
    ),
    test_identity("test_log_redaction", "test_sec_prot_033_raw_nested_sentinel_assertion"): ("SEC-PROT-033",),
    test_identity("test_log_redaction", "test_sec_prot_034_evidence_event_sanitizes_event_type"): (
        "SEC-PROT-034",
    ),
    test_identity("test_log_redaction", "test_sec_prot_035_evidence_event_nested_sentinel_redaction"): (
        "SEC-PROT-035",
    ),
    test_identity("test_log_redaction", "test_sec_prot_036_generic_secret_in_event_type_fails_closed"): (
        "SEC-PROT-036",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_037_generator_rejects_failing_suite"): (
        "SEC-PROT-037",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_038_generator_does_not_overwrite_evidence_on_failure"): (
        "SEC-PROT-038",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_039_missing_required_test_id_fails_generation"): (
        "SEC-PROT-039",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_040_duplicate_test_id_fails_generation"): (
        "SEC-PROT-040",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_041_evidence_results_originate_from_actual_test_result"): (
        "SEC-PROT-041",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_042_duplicate_short_names_do_not_collide"): (
        "SEC-PROT-042",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_043_unsuccessful_suite_rejected_even_with_failed_count_zero"): (
        "SEC-PROT-043",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_044_observation_count_must_equal_tests_run"): (
        "SEC-PROT-044",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_045_failure_cannot_be_overwritten_by_later_pass"): (
        "SEC-PROT-045",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_046_cross_host_check_does_not_report_stale_evidence"): (
        "SEC-PROT-046",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_047_same_host_check_detects_changed_host_inventory"): (
        "SEC-PROT-047",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_048_recorded_host_inventory_decision_is_revalidated"): (
        "SEC-PROT-048",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_049_failure_before_generation_rename_preserves_old_current"): (
        "SEC-PROT-049",
    ),
    test_identity(
        "test_generate_evidence",
        "test_sec_prot_050_failure_after_generation_creation_but_before_pointer_swap_preserves_old_current",
    ): ("SEC-PROT-050",),
    test_identity("test_generate_evidence", "test_sec_prot_051_failure_during_pointer_creation_preserves_old_current"): (
        "SEC-PROT-051",
    ),
    test_identity("test_generate_evidence", "test_sec_prot_052_successful_pointer_swap_exposes_one_complete_generation"): (
        "SEC-PROT-052",
    ),
}

REQUIRED_SECURITY_IDS = frozenset(
    {f"SEC-BL-{number:03d}" for number in range(1, 7)}
    | {f"SEC-PROT-{number:03d}" for number in range(1, 53)}
    | {f"SEC-ISO-{number:03d}" for number in range(1, 5)}
)

_BASELINE_RESULTS: dict[str, BaselineResult] = {}


def validate_test_id_registry(registry: dict[str, tuple[str, ...]] = TEST_ID_REGISTRY) -> None:
    identities = list(registry)
    invalid_identities = [identity for identity in identities if not TEST_IDENTITY_RE.fullmatch(identity)]
    if invalid_identities:
        raise ValueError(f"invalid test identity: {invalid_identities[0]}")
    ids = [test_id for values in registry.values() for test_id in values]
    invalid = [test_id for test_id in ids if not SEC_ID_RE.fullmatch(test_id)]
    if invalid:
        raise ValueError(f"invalid security test id: {invalid[0]}")
    unknown = sorted(set(ids) - REQUIRED_SECURITY_IDS)
    if unknown:
        raise ValueError(f"unknown security test id: {unknown[0]}")
    duplicates = [test_id for test_id, count in Counter(ids).items() if count > 1]
    if duplicates:
        raise ValueError(f"duplicate security test id: {duplicates[0]}")
    missing = sorted(REQUIRED_SECURITY_IDS - set(ids))
    if missing:
        raise ValueError(f"missing required security test id: {missing[0]}")


def clear_baseline_results() -> None:
    _BASELINE_RESULTS.clear()


def record_baseline_result(result: BaselineResult) -> BaselineResult:
    if result.test_id in _BASELINE_RESULTS:
        raise ValueError(f"duplicate baseline result: {result.test_id}")
    _BASELINE_RESULTS[result.test_id] = result
    return result


def baseline_results() -> dict[str, BaselineResult]:
    return dict(_BASELINE_RESULTS)
