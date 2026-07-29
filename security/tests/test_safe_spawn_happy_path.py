from _loader import load_test_functions
from pankster_security_harness.fixtures import synthetic_fixture
from pankster_security_harness.redaction import assert_no_secret_shape, assert_no_sentinel
from pankster_security_harness.runtime_context import default_context
from pankster_security_harness.spawn_prototype import run_fixture_subprocess


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_prot_015_safe_fixture_subprocess_happy_path():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        event = run_fixture_subprocess(context=context, source_env=fixture.gateway_env(), cwd=fixture.workspace_a)

    assert event["event_type"] == "safe_spawn"
    payload = event["payload"]
    assert payload["exit_code"] == 0
    assert payload["stderr"] == ""
    assert payload["cwd"].endswith("/workspaces/a")
    assert "env" in payload
    assert "env_keys" in payload["env"]
    assert "value_metadata" in payload["env"]
    assert "env_values" not in payload["env"]
    assert "redacted_env_values" not in payload["env"]
    assert set(payload["env"]["env_keys"]) <= set(payload["stdout_keys"])
    assert set(payload["env"]["env_keys"]) == {
        "HERMES_HOME",
        "HERMES_KANBAN_DB",
        "HOME",
        "LANG",
        "LC_ALL",
        "NO_PROXY",
        "PATH",
        "SHELL",
        "TMPDIR",
        "no_proxy",
    }
    assert "TELEGRAM_BOT_TOKEN" not in payload["stdout_keys"]
    assert "ANTHROPIC_API_KEY" not in payload["stdout_keys"]
    assert all("PANKSTER_SENTINEL_" not in arg for arg in payload["argv"]["argv"])
    assert_no_sentinel(event)
    assert_no_secret_shape(payload["argv"]["argv"])
