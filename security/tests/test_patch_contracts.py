import dataclasses
from pathlib import Path

from _loader import load_test_functions
from pankster_security_harness.evidence import EvidenceEvent
from pankster_security_harness.fixtures import synthetic_fixture
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.runtime_context import RuntimeSecurityContext, default_context
from pankster_security_harness.spawn_prototype import SpawnPolicyError, run_fixture_subprocess
from pankster_security_harness.grants import GrantReferenceError, validate_grant_reference


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_prot_004_policy_version_validation():
    with synthetic_fixture() as fixture:
        try:
            default_context(
                profile_home=fixture.profile_a_home,
                workspace_root=fixture.workspace_a,
                policy_version="old",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("unsupported policy version was accepted")


def test_sec_prot_005_cwd_root_enforcement():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        try:
            run_fixture_subprocess(context=context, source_env=fixture.gateway_env(), cwd=fixture.workspace_b)
        except SpawnPolicyError:
            pass
        else:
            raise AssertionError("cwd outside workspace roots was accepted")


def test_sec_prot_013_immutable_runtime_security_context():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)

    assert dataclasses.is_dataclass(context)
    try:
        context.profile_id = "mutated"
    except dataclasses.FrozenInstanceError:
        pass
    else:
        raise AssertionError("runtime context was mutable")


def test_sec_prot_014_sanitized_audit_event_contains_metadata_not_secrets():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        event = EvidenceEvent("runtime_context", context.sanitized_metadata()).sanitized()

    assert event["payload"]["profile_id"] == "profile-a"
    assert event["payload"]["credential_grants"] == ["grant:model:synthetic-model"]


def test_runtime_context_rejects_secret_material_in_grants():
    with synthetic_fixture() as fixture:
        try:
            RuntimeSecurityContext(
                profile_id="profile-a",
                session_id="synthetic-session",
                runtime_enabled=True,
                profile_home=fixture.profile_a_home,
                workspace_roots=(fixture.workspace_a,),
                env_allowlist=frozenset({"PATH"}),
                env_required=frozenset(),
                env_denylist=frozenset(),
                credential_grants=("PANKSTER_SENTINEL_ROOT_B8E2",),
                network_policy="disabled",
                policy_version="phase1a.v3",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("secret material in grant references was accepted")


def test_sec_prot_020_strict_grant_references():
    for valid in ("grant:model:opaque-id", "grant:mcp:mcp_01", "grant:service:svc.01"):
        assert validate_grant_reference(valid) == valid

    invalid_values = (
        "sk-live-example",
        "Bearer abc",
        "https://user:password@example.test",
        "grant:unknown:id",
        "grant:model:",
        "grant:model:id with space",
    )
    for invalid in invalid_values:
        try:
            validate_grant_reference(invalid)
        except GrantReferenceError:
            pass
        else:
            raise AssertionError(f"invalid grant reference accepted: {invalid}")


def test_runtime_context_validates_network_session_and_roots():
    with synthetic_fixture() as fixture:
        try:
            default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a, policy_version="phase1a.v3")
        except ValueError:
            raise AssertionError("current policy version was rejected")
        try:
            from pankster_security_harness.runtime_context import RuntimeSecurityContext

            RuntimeSecurityContext(
                profile_id="profile-a",
                session_id="bad session",
                runtime_enabled=True,
                profile_home=fixture.profile_a_home,
                workspace_roots=(fixture.workspace_a,),
                env_allowlist=frozenset({"PATH"}),
                env_required=frozenset(),
                env_denylist=frozenset(),
                credential_grants=("grant:model:ok",),
                network_policy="disabled",
                policy_version="phase1a.v3",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe session_id was accepted")

        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        assert context.workspace_roots == (Path(fixture.workspace_a).resolve(),)


def test_baseline_result_observed_contract():
    good = BaselineResult(
        test_id="SEC-BL-999",
        classification="BASELINE_NOT_REPRODUCED",
        observed=False,
        observation="synthetic issue was not reproduced",
        evidence={"reproduced": False},
        limitations="contract test",
    )
    assert good.observed is False

    try:
        BaselineResult(
            test_id="SEC-BL-998",
            classification="BASELINE_VULNERABILITY_CONFIRMED",
            observed=False,
            observation="contradictory result",
            evidence={},
            limitations="contract test",
        )
    except ValueError:
        pass
    else:
        raise AssertionError("confirmed baseline result without observed=True was accepted")


def test_profile_and_session_id_validation_rejects_unsafe_values():
    bad_values = ("bad\nid", "bad/id", "bad\\id", "..", " bad", "bad ")
    with synthetic_fixture() as fixture:
        for value in bad_values:
            try:
                default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a, profile_id=value)
            except ValueError:
                pass
            else:
                raise AssertionError(f"unsafe profile_id accepted: {value!r}")
