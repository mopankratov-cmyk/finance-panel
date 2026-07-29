"""Immutable runtime policy context for the safe prototype."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar, copy_context
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .env_policy import ENV_NAME_CATALOG, SAFE_ID_RE
from .grants import validate_grant_references

CURRENT_POLICY_VERSION = "phase1a.v3"
NetworkPolicy = Literal["disabled", "loopback", "restricted"]
NETWORK_POLICIES = frozenset({"disabled", "loopback", "restricted"})

current_runtime_context: ContextVar["RuntimeSecurityContext | None"] = ContextVar(
    "current_runtime_context", default=None
)


@dataclass(frozen=True)
class RuntimeSecurityContext:
    profile_id: str
    session_id: str
    runtime_enabled: bool
    profile_home: Path
    workspace_roots: tuple[Path, ...]
    env_allowlist: frozenset[str]
    env_required: frozenset[str]
    env_denylist: frozenset[str]
    credential_grants: tuple[str, ...]
    network_policy: NetworkPolicy
    policy_version: str

    def __post_init__(self) -> None:
        if not self.profile_id or not SAFE_ID_RE.fullmatch(self.profile_id):
            raise ValueError("invalid profile_id")
        if "/" in self.profile_id or "\\" in self.profile_id or ".." in self.profile_id or self.profile_id.strip() != self.profile_id:
            raise ValueError("invalid profile_id")
        if not self.session_id or not SAFE_ID_RE.fullmatch(self.session_id):
            raise ValueError("session_id is required")
        if "/" in self.session_id or "\\" in self.session_id or ".." in self.session_id or self.session_id.strip() != self.session_id:
            raise ValueError("session_id is required")
        if self.network_policy not in NETWORK_POLICIES:
            raise ValueError("invalid network_policy")
        if self.policy_version != CURRENT_POLICY_VERSION:
            raise ValueError("unsupported policy_version")
        if not self.profile_home.is_absolute():
            raise ValueError("profile_home must be absolute")
        if not self.workspace_roots:
            raise ValueError("at least one workspace root is required")
        if any(not root.is_absolute() for root in self.workspace_roots):
            raise ValueError("workspace_roots must be absolute")
        canonical_roots = tuple(dict.fromkeys(root.resolve() for root in self.workspace_roots))
        object.__setattr__(self, "workspace_roots", canonical_roots)
        object.__setattr__(self, "profile_home", self.profile_home.resolve())
        if self.env_allowlist & self.env_denylist:
            raise ValueError("env allowlist collides with denylist")
        unknown_allowlist = self.env_allowlist - ENV_NAME_CATALOG
        if unknown_allowlist:
            raise ValueError("env allowlist contains unknown names")
        if not self.env_required <= self.env_allowlist:
            raise ValueError("env_required must be a subset of env_allowlist")
        object.__setattr__(self, "credential_grants", validate_grant_references(self.credential_grants))

    def sanitized_metadata(self) -> dict[str, object]:
        return {
            "profile_id": self.profile_id,
            "session_id": self.session_id,
            "runtime_enabled": self.runtime_enabled,
            "profile_home": str(self.profile_home),
            "workspace_roots": [str(root) for root in self.workspace_roots],
            "env_allowlist": sorted(self.env_allowlist),
            "env_required": sorted(self.env_required),
            "env_denylist": sorted(self.env_denylist),
            "credential_grants": list(self.credential_grants),
            "network_policy": self.network_policy,
            "policy_version": self.policy_version,
        }


def default_context(
    *,
    profile_home: Path,
    workspace_root: Path,
    profile_id: str = "profile-a",
    kanban_env_allowlist: frozenset[str] | None = None,
    runtime_enabled: bool = True,
    policy_version: str = CURRENT_POLICY_VERSION,
) -> RuntimeSecurityContext:
    from .env_policy import DEFAULT_ENV_ALLOWLIST, MANDATORY_SECRET_DENYLIST

    kanban_env_allowlist = kanban_env_allowlist if kanban_env_allowlist is not None else frozenset({"HERMES_KANBAN_DB"})
    return RuntimeSecurityContext(
        profile_id=profile_id,
        session_id="synthetic-session",
        runtime_enabled=runtime_enabled,
        profile_home=profile_home,
        workspace_roots=(workspace_root,),
        env_allowlist=frozenset(DEFAULT_ENV_ALLOWLIST | kanban_env_allowlist),
        env_required=frozenset({"PATH", "HOME", "TMPDIR", "LANG", "SHELL", "HERMES_HOME"}),
        env_denylist=frozenset(MANDATORY_SECRET_DENYLIST),
        credential_grants=("grant:model:synthetic-model",),
        network_policy="disabled",
        policy_version=policy_version,
    )


def run_in_copied_context(function, *args, **kwargs):
    context = copy_context()
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(lambda: context.run(function, *args, **kwargs))
        return future.result()


def run_without_copied_context(function, *args, **kwargs):
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(function, *args, **kwargs)
        return future.result()


def run_batch_in_copied_context(functions):
    with ThreadPoolExecutor(max_workers=len(functions) or 1) as executor:
        futures = []
        for function in functions:
            context = copy_context()
            futures.append(executor.submit(lambda fn=function, ctx=context: ctx.run(fn)))
        return [future.result() for future in futures]


def run_nested_in_copied_context(function):
    return run_in_copied_context(lambda: run_in_copied_context(function))


def run_background_in_copied_context(function, *args, **kwargs):
    context = copy_context()
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="phase1a-bg") as executor:
        future = executor.submit(lambda: context.run(function, *args, **kwargs))
        return future.result()


class ReusedContextExecutor:
    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="phase1a-reused")

    def submit_with_context(self, function, *args, **kwargs):
        context = copy_context()
        return self._executor.submit(lambda: context.run(function, *args, **kwargs))

    def submit_without_context(self, function, *args, **kwargs):
        return self._executor.submit(function, *args, **kwargs)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True)
