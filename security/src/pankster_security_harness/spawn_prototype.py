"""Safe spawn prototype for synthetic subprocesses only."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from .env_policy import EnvironmentPolicyError, build_safe_environment, sanitized_env_event
from .evidence import EvidenceEvent, argv_snapshot
from .redaction import assert_no_sentinel
from .runtime_context import CURRENT_POLICY_VERSION, RuntimeSecurityContext


class SpawnPolicyError(ValueError):
    pass


def _is_within(path: Path, roots: tuple[Path, ...]) -> bool:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
            return True
        except ValueError:
            continue
    return False


def validate_spawn_request(
    *,
    context: RuntimeSecurityContext,
    cwd: Path,
    env: dict[str, str],
) -> None:
    if not context.runtime_enabled:
        raise SpawnPolicyError("runtime is disabled")
    if context.policy_version != CURRENT_POLICY_VERSION:
        raise SpawnPolicyError("policy version is not current")
    if not _is_within(cwd, context.workspace_roots):
        raise SpawnPolicyError("cwd is outside allowed workspace roots")
    if not context.credential_grants:
        raise SpawnPolicyError("credential grant reference is required")
    if any("PANKSTER_SENTINEL_" in value for value in env.values()):
        raise SpawnPolicyError("environment contains synthetic secret material")


def run_fixture_subprocess(
    *,
    context: RuntimeSecurityContext,
    source_env: dict[str, str],
    cwd: Path,
) -> dict[str, object]:
    env = build_safe_environment(
        source_env=source_env,
        profile_home=context.profile_home,
        hermes_home=context.profile_home,
        allowlist=context.env_allowlist,
        required=context.env_required,
        denylist=context.env_denylist,
        session_id=context.session_id,
    )
    validate_spawn_request(context=context, cwd=cwd, env=env)
    code = "import json, os; print(json.dumps(sorted(os.environ)))"
    argv = [sys.executable, "-c", code]
    argv_event = argv_snapshot(argv)
    completed = subprocess.run(
        argv,
        cwd=str(cwd),
        env=env,
        check=True,
        capture_output=True,
        text=True,
        timeout=5,
    )
    stdout_keys = json.loads(completed.stdout)
    event = EvidenceEvent(
        "safe_spawn",
        {
            "profile_id": context.profile_id,
            "policy_version": context.policy_version,
            "cwd": str(cwd),
            "env": sanitized_env_event(
                env,
                policy_version=context.policy_version,
                sources={"HOME": "explicit_override", "HERMES_HOME": "explicit_override", "TMPDIR": "profile_session_tmpdir"},
            ),
            "argv": argv_event,
            "stdout_keys": stdout_keys,
            "exit_code": completed.returncode,
            "stderr": completed.stderr,
        },
    ).sanitized()
    assert_no_sentinel(event)
    return event


__all__ = [
    "EnvironmentPolicyError",
    "SpawnPolicyError",
    "run_fixture_subprocess",
    "validate_spawn_request",
]
