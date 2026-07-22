# Phase 1A Baseline Results

Baseline tests use only synthetic `TemporaryDirectory` fixtures and return
structured `BaselineResult` objects. The result contract uses `observed: bool`
and `observation: str`; `BASELINE_VULNERABILITY_CONFIRMED` requires
`observed=True`, and `BASELINE_NOT_REPRODUCED` requires `observed=False`.

| Test ID | Finding | Result | Evidence | Limitations |
| --- | --- | --- | --- | --- |
| SEC-BL-001 | Gateway-style environment inheritance can pass a synthetic Telegram token into a worker env. | BASELINE_VULNERABILITY_CONFIRMED | `baseline_worker_env()` copies the synthetic gateway env and only overrides `HERMES_HOME`. | Fixture models the discovered pattern; it does not start the gateway. |
| SEC-BL-002 | Same-UID child subprocess can read a synthetic root auth store despite profile-home separation. | BASELINE_VULNERABILITY_CONFIRMED | Child starts with `HOME=profile-a`, `HERMES_HOME=profile-a`, `cwd=workspace-a`, then reads the synthetic root auth path. | Does not read real root auth or real home paths. |
| SEC-BL-003 | Missing profile provider can fall back to synthetic root provider. | BASELINE_VULNERABILITY_CONFIRMED | `baseline_select_provider()` returns the synthetic root provider marker. | Does not call OAuth or providers. |
| SEC-BL-004 | `ContextVar` survives direct and wrapped thread calls, but is lost in an unwrapped thread hop. | BASELINE_PARTIALLY_CONFIRMED | Direct and `copy_context()` calls keep profile context; unwrapped `ThreadPoolExecutor` returns `None`. | Python fixture characterizes context behavior, not all Hermes executors. |
| SEC-BL-005 | Checking only that a profile exists is insufficient when `runtime_enabled=false`. | BASELINE_VULNERABILITY_CONFIRMED | Synthetic profile map returns exists=true while runtime gate is false. | Does not query live Kanban. |
| SEC-BL-006 | Current modeled allowlists can preserve only one of `NO_PROXY` or `no_proxy`. | BASELINE_VULNERABILITY_CONFIRMED | Terminal/MCP allowlists differ from code execution allowlist in the fixture. | Models the policy inconsistency, not live env output. |
