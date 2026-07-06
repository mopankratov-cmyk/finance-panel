# Factory Wave 1 Status

## Scope in progress

- Separate clean `Publication Cockpit` pod without finance shell.
- Unified `ChannelAdapter` layer for `Pinterest` and `Telegram`.
- Live publish entrypoint `POST /api/factory/publish` for wave-1 channels.
- Safe `boot/partial/full` cockpit payload states without schema-crash on missing Supabase.
- Market loop surface in cockpit: `post_metrics -> winners -> improvementLoop`.

## Current clean-pod state

- Public route lives at `/inferno/publishing` without finance sidebar/login shell.
- Cockpit API answers in `configured:true` partial mode even when part of `factory_*` schema is missing.
- `post_metrics` read-path now supports legacy fallback contracts:
  - full: `recipe_id + publication_id + external_post_id + ...`
  - legacy: `recipe_id + external_post_id + ...`
  - minimal legacy: `recipe_id + views + watch_rate + ctr_card + saves + posted_at`
- Channel capabilities are exposed in payload:
  - `Pinterest`: `publish + analytics`
  - `Telegram`: `publish only`
- `POST /api/factory/publish` now drives adapters directly:
  - accepts `target_id` or inline `target`
  - runs `authSession` before publish
  - returns adapter-native publish result
  - persists into `factory_publications` only as best-effort when write-path and table exist
  - reports `write_blocked` / warnings honestly instead of faking persistence
- `POST /api/factory/post-metrics` now fails honestly in clean pod when write secrets are absent:
  - returns `write_blocked:true`
  - reason: missing `SUPABASE_SERVICE_ROLE_KEY`
  - no fake “ok” and no vague “Supabase не настроен” for this case
- `GET /api/factory/status` now exposes publication-specific readiness:
  - `publication_wave1.supabase_read`
  - `publication_wave1.supabase_write`
  - `publication_wave1.pinterest_token`
  - `publication_wave1.telegram_bot`
  - `publication_wave1.telegram_chat`
  - `publication_wave1.tables.factory_publications`
  - `publication_wave1.tables.factory_distribution_targets`
  - `publication_wave1.tables.post_metrics`
- `GET /api/factory/winners` now degrades as read-only in clean pod instead of requiring service-role for simple list reads.
- `POST /api/factory/winners` now returns an `improvement_loop` payload:
  - promoted winner niche
  - `preset_id`
  - `winner_preset_count`
  - current `learning_hints`
  - `next_cycle_ready`
- `POST /api/factory/post-metrics` now forwards that winner payload back as `forwarded_payload`
  so the market loop is visible as `post_metrics -> winners -> next cycle hints` even before a dedicated
  improvement service or migrations are available in the clean pod.

## Current blockers outside allowed edit zone

- Real live payload still depends on missing database objects in the target Supabase:
  - `factory_publications`
  - `factory_distribution_targets`
  - full write-compatible `post_metrics` path parity
  - write-capable `SUPABASE_SERVICE_ROLE_KEY` in the clean Vercel project
- Full closed loop with real persisted publication rows still depends on schema parity between the clean pod and the main factory environment.

## Verified now

- `npm run build` passes in this clean worktree.
- Production deploy for the clean pod is green.
- Cockpit payload exposes coverage/warnings instead of crashing on missing tables.
- Publish API surface exists end-to-end in code for Pinterest and Telegram, even when clean pod can only persist in partial mode.

## Notes

- These blockers should not be bypassed with ad-hoc migrations in this repo.
- Until infra catches up, the clean pod stays operational in `partial` mode instead of crashing or pretending writes succeeded.
