# Phase 0 Evidence Index

Status: `awaiting_review`. This index records only sanitized, read-only evidence. No secret-bearing file was opened. Paths to credential stores and their metadata are recorded; values are not.

## Portable path aliases

Sanitized local observation metadata (the sole absolute user path in this bundle):

- `<USER_HOME>` = `/Users/maksimpankratov`
- `<HERMES_HOME>` = `<USER_HOME>/.hermes`
- `<HERMES_SOURCE>` = `<HERMES_HOME>/hermes-agent`
- `<REPO_ROOT>` = current Phase 0 worktree root
- `<COCKPIT_ROOT>` = `<USER_HOME>/pankster-cockpit`

## Evidence conventions

- `CONFIRMED`: the installed code or sanitized host metadata directly demonstrates the claim.
- `PARTIALLY_CONFIRMED`: part of the path is demonstrated, while a runtime precondition was intentionally not inspected or executed.
- `NOT_CONFIRMED`: inspected evidence contradicts the preliminary claim.
- `NOT_APPLICABLE`: the path is not used in this installation.
- `UNVERIFIED`: verification would require a forbidden action or secret access.

## Host and installation evidence

| ID | Sanitized evidence | Result |
|---|---|---|
| E-HOST-01 | `sw_vers; uname -m` | macOS 26.5.2, build 25F84, arm64. |
| E-HERMES-01 | `git -C <HERMES_SOURCE> rev-parse HEAD` | `97c67d585e3048c8b9a918d5382005566080903a`. |
| E-HERMES-02 | `<HERMES_SOURCE>/venv/bin/hermes version` | Hermes Agent 0.18.2, Python 3.11.15, git install. |
| E-HERMES-03 | `git ... status --short` plus first line of `.install_method` | One untracked installation marker; marker says `git`. No runtime file changed by this audit. |
| E-RUNTIME-01 | sanitized `ps -axo pid,user,command` filter | Gateway, dashboard, gbrain adapter, and live Cockpit run as OS user `maksimpankratov`. |
| E-RUNTIME-02 | `lsof -nP -iTCP -sTCP:LISTEN` filtered to known local ports | Dashboard `127.0.0.1:9119`; desktop serve `:51727`; Cockpit `:9120`; gbrain adapter `:3132`. |
| E-SERVICE-01 | `PlistBuddy` reads of Label, ProgramArguments, WorkingDirectory, RunAtLoad, KeepAlive only | launchd owns gateway, dashboard, gbrain adapter, and Cockpit. Environment dictionary presence was noted without reading values. |
| E-ISO-01 | `command -v` for Docker, Podman, Colima, Lima, limactl, nerdctl | All absent from PATH; active processes are same-UID host processes. |

## Filesystem and datastore evidence

| ID | Sanitized evidence | Result |
|---|---|---|
| E-PROFILE-01 | `find` + `stat` restricted to profile names, known filenames, modes, owners | Named profiles are `content-director` and `dev-director`; profile dirs are owner-only for memories/sessions/skills/logs, but `home` and `workspace` are 0755. |
| E-AUTH-01 | `find ... -name auth.json -exec stat ...` | Root auth store exists at `<HERMES_HOME>/auth.json`, mode 0600; no named-profile `auth.json` was found. Contents were not read. |
| E-KANBAN-01 | `find ... -name kanban.db -exec stat ...` | Default and named-board SQLite files exist under `<HERMES_HOME>`; metadata only was read. |
| E-ARTIFACT-01 | filename-only `find` under `<USER_HOME>/fleet-control-room/evidence` and `backups` | Evidence packs and rollback backups exist, but are a separate filesystem convention rather than a workflow-owned artifact store. |

## Safe structural config evidence

The script below parsed YAML and emitted only explicitly allowlisted non-secret fields. It did not emit environment values, headers, tokens, or arbitrary config values.

```text
default: multiplex_profiles=UNSET; dispatch_in_gateway=True;
         mcp_names=[gbrain, gitea, supabase]; provider=openai-codex
content-director: multiplex_profiles=UNSET; mcp_names=[];
                  provider=openai-codex; toolsets=[hermes-cli, kanban]
dev-director: multiplex_profiles=UNSET; mcp_names=[];
              provider=openai-codex; toolsets=[hermes-cli, kanban]
both named profile.yaml files: keys=[description, description_auto];
runtime_enabled absent
```

The `hermes-cli` composite includes terminal, process, file, code execution, and delegation tools at `<HERMES_SOURCE>/toolsets.py:29-81`.

## Repositories observed

| Path | Commit/branch at observation | Dirty count | Note |
|---|---|---:|---|
| `<HERMES_SOURCE>` | `97c67d585e30`, `main` | 1 | Installed Hermes; only `.install_method` untracked. |
| `<USER_HOME>/PANKSTER` | `dacacbceee7f`, `main` | 0 | Obsidian/knowledge vault. |
| `<USER_HOME>/Projects/finance-panel/finance-panel` | observed separately from this worktree | pre-existing | Product repository; audit work is isolated in the Phase 0 worktree. |
| `<USER_HOME>/Projects/finance-panel/content-factory` | `1b1e31849e3e` | 190 | Related external repository; not modified. |
| `<USER_HOME>/Projects/rita-ai/director-cockpit` | `eae182ae1e4d` | 0 | Separate Next.js command-center project; not the live local Cockpit process. |
| `<USER_HOME>/fleet-control-room` | `7a38d242004c`, `main` | 43 | Policies, evidence, backups; not modified. |
| `<COCKPIT_ROOT>` | `0dd33432d2ea` | 0 | Live local thin proxy/UI; not modified. |

Dirty counts are observational and may change independently. No cleanup, checkout, reset, or mutation was performed.

## Commands executed

The following command families were executed read-only unless explicitly noted as documentation setup. Arguments that could disclose values were never used.

```bash
sed -n '1,260p' <attached-task>
sed -n '261,620p' <attached-task>
sed -n '621,940p' <attached-task>
sed -n '1,320p' <USER_HOME>/.agents/skills/gstack/cso/SKILL.md
sed -n '321,760p' <USER_HOME>/.agents/skills/gstack/cso/SKILL.md
sed -n '761,1320p' <USER_HOME>/.agents/skills/gstack/cso/SKILL.md
git status --short --branch
git rev-parse main
git log -1 --oneline --decorate
git worktree list --porcelain
git worktree add -b phase/0-architecture-baseline <REPO_ROOT> main
sw_vers
uname -m
git -C <HERMES_SOURCE> rev-parse --abbrev-ref HEAD
git -C <HERMES_SOURCE> rev-parse HEAD
git -C <HERMES_SOURCE> status --short
sed -n '1p' <HERMES_SOURCE>/.install_method
<HERMES_SOURCE>/venv/bin/hermes version
<HERMES_SOURCE>/venv/bin/python <version-only metadata script>
ps -axo pid=,user=,command= <sanitized process filter>
lsof -nP -iTCP -sTCP:LISTEN <local-port filter>
/usr/libexec/PlistBuddy <Label/ProgramArguments/WorkingDirectory/RunAtLoad/KeepAlive only>
command -v docker podman colima lima limactl nerdctl
find <HERMES_HOME>/profiles <names and metadata only>
find <HERMES_HOME> -name auth.json -exec stat ...
find <HERMES_HOME> -name kanban.db -exec stat ...
python3 <allowlisted non-secret YAML structure script>
git -C <observed-repository> rev-parse/status <metadata only>
find <USER_HOME>/fleet-control-room <directory and filename inventory>
find <USER_HOME>/PANKSTER <backup/sync/deploy filename inventory>
nl -ba <USER_HOME>/PANKSTER/sync-gbrain.sh
rg --files <HERMES_SOURCE>
rg -n <target symbols> <HERMES_SOURCE>/{agent,gateway,hermes_cli,tools}
nl -ba <target source file> | sed -n <bounded line ranges>
find app/agent app/api/agent components/agent lib/agent <file inventory>
rg -n <architecture terms> docs app/agent app/api/agent components/agent lib/agent
find <USER_HOME>/Projects/rita-ai/director-cockpit/app <route inventory>
sed -n '1,180p' <USER_HOME>/Projects/rita-ai/director-cockpit/README.md
python3 <package.json name/script/framework-only script>
date -u +%Y-%m-%dT%H:%M:%SZ
mkdir -p docs/program docs/architecture docs/adr docs/security
```

Two attempted interpreter paths and one unmatched zsh glob failed without side effects:

```text
<HERMES_SOURCE>/.venv/bin/python: absent
<HERMES_HOME>/venv/bin/python: absent
<HERMES_HOME>/profiles/*/auth.json: no matches
```

## Explicit exclusions

- No `auth.json`, `.env`, Keychain, cookie store, private key, or secret-bearing log content was read.
- No network, API, model, pytest, canary, profile, gateway, database, dependency, merge, push, or deployment command was run.
- No runtime, service, profile, database, Cockpit production file, or environment variable was modified.
