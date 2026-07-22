"""Synthetic filesystem and credential fixtures for Phase 1A."""

from __future__ import annotations

import json
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .sentinels import (
    GATEWAY_SENTINEL,
    MCP_SENTINEL,
    OAUTH_SENTINEL,
    PROFILE_A_SENTINEL,
    PROFILE_B_SENTINEL,
    ROOT_SENTINEL,
)


@dataclass(frozen=True)
class SyntheticFixture:
    temp_root: Path
    user_home: Path
    hermes_home: Path
    root_auth: Path
    root_env: Path
    profile_a_home: Path
    profile_a_auth: Path
    profile_b_home: Path
    profile_b_auth: Path
    workspace_a: Path
    workspace_b: Path

    def gateway_env(self) -> dict[str, str]:
        return {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.user_home),
            "TMPDIR": str(self.temp_root / "tmp"),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "SHELL": "/bin/zsh",
            "NO_PROXY": "localhost,127.0.0.1",
            "no_proxy": "localhost,127.0.0.1",
            "HERMES_HOME": str(self.hermes_home),
            "HERMES_KANBAN_DB": str(self.temp_root / "kanban.sqlite"),
            "TELEGRAM_BOT_TOKEN": GATEWAY_SENTINEL,
            "ANTHROPIC_API_KEY": ROOT_SENTINEL,
            "MCP_FAKE_TOKEN": MCP_SENTINEL,
            "OAUTH_REFRESH_TOKEN": OAUTH_SENTINEL,
        }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, sort_keys=True, indent=2), encoding="utf-8")


@contextmanager
def synthetic_fixture() -> Iterator[SyntheticFixture]:
    with tempfile.TemporaryDirectory(prefix="pankster-phase1a-") as raw_root:
        temp_root = Path(raw_root)
        user_home = temp_root / "user-home"
        hermes_home = user_home / ".hermes"
        profile_a_home = temp_root / "profile-a"
        profile_b_home = temp_root / "profile-b"
        workspace_a = temp_root / "workspaces" / "a"
        workspace_b = temp_root / "workspaces" / "b"

        for path in (hermes_home, profile_a_home, profile_b_home, workspace_a, workspace_b, temp_root / "tmp"):
            path.mkdir(parents=True, exist_ok=True)

        root_auth = hermes_home / "auth.json"
        root_env = hermes_home / ".env"
        profile_a_auth = profile_a_home / "auth.json"
        profile_b_auth = profile_b_home / "auth.json"

        _write_json(root_auth, {"providers": {"anthropic": ROOT_SENTINEL}})
        root_env.write_text(f"TELEGRAM_BOT_TOKEN={GATEWAY_SENTINEL}\n", encoding="utf-8")
        _write_json(profile_a_auth, {"providers": {"profile-only": PROFILE_A_SENTINEL}})
        _write_json(profile_b_auth, {"providers": {"profile-only": PROFILE_B_SENTINEL}})

        yield SyntheticFixture(
            temp_root=temp_root,
            user_home=user_home,
            hermes_home=hermes_home,
            root_auth=root_auth,
            root_env=root_env,
            profile_a_home=profile_a_home,
            profile_a_auth=profile_a_auth,
            profile_b_home=profile_b_home,
            profile_b_auth=profile_b_auth,
            workspace_a=workspace_a,
            workspace_b=workspace_b,
        )


def baseline_worker_env(gateway_env: dict[str, str], profile_home: Path) -> dict[str, str]:
    env = dict(gateway_env)
    env["HERMES_HOME"] = str(profile_home)
    return env


def baseline_select_provider(profile_auth: Path, root_auth: Path, provider: str) -> str | None:
    profile_data = json.loads(profile_auth.read_text(encoding="utf-8"))
    profile_provider = profile_data.get("providers", {}).get(provider)
    if profile_provider:
        return str(profile_provider)
    root_data = json.loads(root_auth.read_text(encoding="utf-8"))
    root_provider = root_data.get("providers", {}).get(provider)
    return str(root_provider) if root_provider else None
