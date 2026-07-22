from _loader import load_test_functions
from pankster_security_harness.baseline import BaselineResult
from pankster_security_harness.fixtures import baseline_worker_env, synthetic_fixture
from pankster_security_harness.sentinels import GATEWAY_SENTINEL
from pankster_security_harness.test_registry import record_baseline_result


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_bl_001_gateway_env_inheritance_characterizes_vulnerability():
    with synthetic_fixture() as fixture:
        worker_env = baseline_worker_env(fixture.gateway_env(), fixture.profile_a_home)
        result = record_baseline_result(BaselineResult(
            test_id="SEC-BL-001",
            classification="BASELINE_VULNERABILITY_CONFIRMED",
            observed=True,
            observation="synthetic gateway sentinel present in worker environment",
            evidence={"token_key_present": "TELEGRAM_BOT_TOKEN" in worker_env},
            limitations="fixture does not start live gateway",
        ))

    assert worker_env["TELEGRAM_BOT_TOKEN"] == GATEWAY_SENTINEL
    assert worker_env["HERMES_HOME"].endswith("profile-a")
    assert result.classification == "BASELINE_VULNERABILITY_CONFIRMED"
    assert result.observed is True
    assert result.evidence["token_key_present"] is True
