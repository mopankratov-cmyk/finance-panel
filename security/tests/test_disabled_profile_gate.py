from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.fixtures import synthetic_fixture
from pankster_security_harness.runtime_context import default_context
from pankster_security_harness.spawn_prototype import SpawnPolicyError, run_fixture_subprocess
from pankster_security_harness.test_registry import record_baseline_result


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def _baseline_profile_exists(profile_id: str, profiles: dict[str, dict[str, object]]) -> bool:
    return profile_id in profiles


def test_sec_bl_005_disabled_profile_without_runtime_gate_is_insufficient():
    profiles = {"content-director": {"runtime_enabled": False}}
    result = record_baseline_result(BaselineResult(
        test_id="SEC-BL-005",
        classification="BASELINE_VULNERABILITY_CONFIRMED",
        observed=True,
        observation="profile existence check passes while runtime_enabled is false",
        evidence={"exists": _baseline_profile_exists("content-director", profiles), "runtime_enabled": False},
        limitations="synthetic profile map only",
    ))

    assert _baseline_profile_exists("content-director", profiles) is True
    assert profiles["content-director"]["runtime_enabled"] is False
    assert result.evidence["exists"] is True
    assert result.evidence["runtime_enabled"] is False


def test_sec_prot_003_runtime_enabled_fail_closed():
    with synthetic_fixture() as fixture:
        context = default_context(
            profile_home=fixture.profile_a_home,
            workspace_root=fixture.workspace_a,
            runtime_enabled=False,
        )
        try:
            run_fixture_subprocess(context=context, source_env=fixture.gateway_env(), cwd=fixture.workspace_a)
        except SpawnPolicyError:
            pass
        else:
            raise AssertionError("disabled runtime did not fail closed")
