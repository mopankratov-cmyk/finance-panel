from _loader import load_test_functions
from pankster_security_harness.env_policy import (
    DEFAULT_ENV_ALLOWLIST,
    EnvironmentPolicyError,
    KANBAN_ENV_ALLOWLIST,
    build_safe_environment,
    create_profile_tmpdir,
    sanitized_env_event,
)
from pankster_security_harness.fixtures import synthetic_fixture
from pankster_security_harness.redaction import assert_no_sentinel
from pankster_security_harness.runtime_context import default_context
from pankster_security_harness.sentinels import GATEWAY_SENTINEL


def load_tests(loader, tests, pattern):
    return load_test_functions(globals())


def test_sec_prot_001_allowlisted_environment_excludes_gateway_secret():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        env = build_safe_environment(
            source_env=fixture.gateway_env(),
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert "TELEGRAM_BOT_TOKEN" not in env
    assert "ANTHROPIC_API_KEY" not in env
    assert env["HOME"].endswith("profile-a")
    assert_no_sentinel(sanitized_env_event(env, policy_version=context.policy_version))


def test_sec_prot_002_mandatory_denylist_applies_last_to_overrides():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        try:
            build_safe_environment(
                source_env=fixture.gateway_env(),
                profile_home=context.profile_home,
                hermes_home=context.profile_home,
                allowlist=context.env_allowlist | {"TELEGRAM_BOT_TOKEN"},
                required=context.env_required,
            denylist=frozenset(),
            session_id=context.session_id,
            overrides={"TELEGRAM_BOT_TOKEN": GATEWAY_SENTINEL},
        )
        except EnvironmentPolicyError:
            pass
        else:
            raise AssertionError("denylisted override did not fail closed")


def test_sec_prot_006_no_proxy_and_lowercase_no_proxy_are_preserved():
    with synthetic_fixture() as fixture:
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        env = build_safe_environment(
            source_env=fixture.gateway_env(),
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert env["NO_PROXY"] == "localhost,127.0.0.1"
    assert env["no_proxy"] == "localhost,127.0.0.1"
    assert "HERMES_KANBAN_DB" in env


def test_sec_prot_017_explicit_kanban_env_list_rejects_wildcard_names():
    with synthetic_fixture() as fixture:
        source = fixture.gateway_env()
        source["HERMES_KANBAN_EXTRA_SECRET"] = "not-copied"
        context = default_context(profile_home=fixture.profile_a_home, workspace_root=fixture.workspace_a)
        env = build_safe_environment(
            source_env=source,
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert KANBAN_ENV_ALLOWLIST == {
        "HERMES_KANBAN_DB",
        "HERMES_KANBAN_TASK_ID",
        "HERMES_KANBAN_RUN_ID",
        "HERMES_KANBAN_PROFILE_ID",
    }
    assert "HERMES_KANBAN_EXTRA_SECRET" not in env


def test_sec_prot_018_profile_scoped_tmpdir_is_unique_per_profile_session():
    with synthetic_fixture() as fixture:
        tmp_a = create_profile_tmpdir(profile_home=fixture.profile_a_home, session_id="session-a")
        tmp_b = create_profile_tmpdir(profile_home=fixture.profile_b_home, session_id="session-a")
        tmp_c = create_profile_tmpdir(profile_home=fixture.profile_a_home, session_id="session-c")

        assert tmp_a.is_absolute()
        assert tmp_a.exists()
        assert tmp_a != tmp_b
        assert tmp_a != tmp_c
        assert tmp_a.is_relative_to(fixture.profile_a_home.resolve())


def test_sec_prot_019_reject_symlink_escape_for_profile_tmpdir():
    with synthetic_fixture() as fixture:
        tmpdir = fixture.profile_a_home / "runtime" / "escape-session" / "tmp"
        tmpdir.parent.mkdir(parents=True)
        tmpdir.symlink_to(fixture.temp_root)
        try:
            create_profile_tmpdir(profile_home=fixture.profile_a_home, session_id="escape-session")
        except EnvironmentPolicyError:
            pass
        else:
            raise AssertionError("symlink escape was accepted")


def test_evidence_env_event_contains_no_values_helper():
    event = sanitized_env_event(
        {"HOME": "/synthetic/profile-a", "PATH": "/usr/bin:/bin"},
        policy_version="phase1a.v2",
        sources={"HOME": "explicit_override"},
    )

    assert event["env_keys"] == ["HOME", "PATH"]
    assert event["value_metadata"]["HOME"]["source"] == "explicit_override"
    assert "env_values" not in event
    assert "redacted_env_values" not in event
    assert "/synthetic/profile-a" not in str(event)


def test_sec_prot_023_reject_secret_shaped_allowed_env_value():
    cases = (
        ("PATH", "sk-abcdefghijk"),
        ("LANG", "Bearer abcdef"),
        ("NO_PROXY", "https://user:password@example.test"),
        ("HERMES_KANBAN_TASK_ID", "password=hunter2"),
        ("LC_ALL", "api_key=value123"),
    )
    with synthetic_fixture() as fixture:
        context = default_context(
            profile_home=fixture.profile_a_home,
            workspace_root=fixture.workspace_a,
            kanban_env_allowlist=frozenset({"HERMES_KANBAN_TASK_ID"}),
        )
        for key, value in cases:
            source = fixture.gateway_env()
            source[key] = value
            try:
                build_safe_environment(
                    source_env=source,
                    profile_home=context.profile_home,
                    hermes_home=context.profile_home,
                    allowlist=context.env_allowlist,
                    required=context.env_required,
                    denylist=context.env_denylist,
                    session_id=context.session_id,
                )
            except EnvironmentPolicyError as error:
                assert key in str(error)
                assert value not in str(error)
            else:
                raise AssertionError(f"secret-shaped value for {key} was accepted")

        positive = fixture.gateway_env()
        positive["HERMES_KANBAN_TASK_ID"] = "task-123"
        env = build_safe_environment(
            source_env=positive,
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )
        assert env["HERMES_KANBAN_TASK_ID"] == "task-123"


def test_sec_prot_027_tmpdir_traversal_rejected_without_side_effect():
    bad_session_ids = ("../../escape", "../escape", "a/b", "a\\b", "..", "bad session", "bad\nsession")
    with synthetic_fixture() as fixture:
        outside = fixture.temp_root / "escape"
        for session_id in bad_session_ids:
            try:
                create_profile_tmpdir(profile_home=fixture.profile_a_home, session_id=session_id)
            except EnvironmentPolicyError:
                pass
            else:
                raise AssertionError(f"unsafe session id accepted: {session_id!r}")
            assert not outside.exists()


def test_sec_prot_028_context_can_deny_all_kanban_variables():
    with synthetic_fixture() as fixture:
        context = default_context(
            profile_home=fixture.profile_a_home,
            workspace_root=fixture.workspace_a,
            kanban_env_allowlist=frozenset(),
        )
        env = build_safe_environment(
            source_env=fixture.gateway_env(),
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert not any(name.startswith("HERMES_KANBAN_") for name in env)


def test_sec_prot_029_context_allows_only_selected_kanban_variables():
    with synthetic_fixture() as fixture:
        source = fixture.gateway_env()
        source["HERMES_KANBAN_TASK_ID"] = "task-1"
        source["HERMES_KANBAN_RUN_ID"] = "run-1"
        context = default_context(
            profile_home=fixture.profile_a_home,
            workspace_root=fixture.workspace_a,
            kanban_env_allowlist=frozenset({"HERMES_KANBAN_TASK_ID"}),
        )
        env = build_safe_environment(
            source_env=source,
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert "HERMES_KANBAN_TASK_ID" in env
    assert "HERMES_KANBAN_DB" not in env
    assert "HERMES_KANBAN_RUN_ID" not in env


def test_sec_prot_030_unknown_kanban_variable_denied():
    with synthetic_fixture() as fixture:
        source = fixture.gateway_env()
        source["HERMES_KANBAN_UNKNOWN"] = "unknown"
        context = default_context(
            profile_home=fixture.profile_a_home,
            workspace_root=fixture.workspace_a,
            kanban_env_allowlist=frozenset({"HERMES_KANBAN_TASK_ID"}),
        )
        env = build_safe_environment(
            source_env=source,
            profile_home=context.profile_home,
            hermes_home=context.profile_home,
            allowlist=context.env_allowlist,
            required=context.env_required,
            denylist=context.env_denylist,
            session_id=context.session_id,
        )

    assert "HERMES_KANBAN_UNKNOWN" not in env
    assert "HERMES_KANBAN_UNKNOWN" not in DEFAULT_ENV_ALLOWLIST
