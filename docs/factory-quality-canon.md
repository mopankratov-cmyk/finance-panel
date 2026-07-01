# Factory quality canon

Дата: 2026-07-01.

Единый канон качества нужен, чтобы контент-завод не спорил сам с собой: один модуль пропускает хук, второй режет его, третий тратит FAL и только потом ругается.

## Уровни качества

1. Source quality: Product Twin / prepared / real / WB / none.
2. Prompt quality: opener, identity lock, motion discipline, no generic ad slop.
3. Pre-submit economics: не платить за weak draft.
4. Render QA: artifact-check, frames/video critic, product identity.
5. Memory quality: winners, anti-patterns, post metrics.

## Источники правды

- Product source priority: `lib/factory/assetBind.ts`.
- Batch source gate: `lib/factory/sourceReadiness.ts` + `app/api/factory/batch/route.ts`.
- Product Twin readiness: `lib/factory/productTwin.ts`, `lib/factory/productTwinQuality.ts`.
- Prompting rules: `docs/factory-prompting-canon.md`.
- Motion b-roll graphics: `docs/factory-broll-canon.md`.
- Paid Reels Brain guard: `lib/factory/reelsBrainCostGovernor.ts` and cron autopilot guard.

## Decisions

- `product_twin` is prepared-tier source when it is a non-service image. `broll_ready` or `hero_ready` makes it canonical for binding.
- `yandex-disk:/...` is durable storage, not a browser preview URL.
- `frames_unavailable` is a soft OTK signal only when score/artifact status is good; it is not a quality pass by itself.
- WB-only sources are prep inputs, not quality-first render sources.
- Paid routes must require an explicit submit/build/apply flag.

## Next consolidation targets

- Move generic opener blocklists into one shared module.
- Make route-level artifact-check import the same `runArtifactCheck` used by graph-run.
- Wire pre-submit scenario quality into graph-run before paid submit.
- Decide whether Product Twin failing every visual threshold returns `null` or remains advisory with `needs_review`.
