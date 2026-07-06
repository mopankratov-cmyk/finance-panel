# Clean Publication Cockpit Design Source

Этот файл фиксирует текущий source of truth для отдельного clean `Publication Cockpit`.

## External design handoff

- Archive from owner:
  - `/Users/maksimpankratov/Downloads/Product studio owner UX (5).zip`
- Inside the archive the real hifi reference lives in:
  - `design_handoff_publishing_cockpit/Publishing Cockpit (standalone).html`
  - `design_handoff_publishing_cockpit/README.md`

Это и есть основной визуальный канон для `1 in 1` recreation. Текущий TSX должен тянуться именно к нему, а не к старому finance-shell screenshot.

## Live surface

- Route: `/inferno/publishing`
- Production URL: `https://finance-panel-publishing-clean.vercel.app/inferno/publishing`

## Primary implementation files

- `app/inferno/publishing/page.tsx`
- `app/inferno/publishing/PublishingCockpit.tsx`
- `app/api/factory/publishing-cockpit/route.ts`
- `lib/factory/publishingCockpit.ts`

## Visual direction

- Отдельный `Inferno`-surface, без `finance-shell`, без finance sidebar/login chrome.
- Dark mission-control shell from the standalone handoff.
- Brand accent: acid lime for active stream / primary CTA / current section.
- Верхний фолд должен повторять handoff-структуру:
  - left rail `INFERNO / Контент-завод`
  - active studio rail with `Content studio / UGC studio / Publication`
  - compact global header
  - compact horizontal tab row
  - floating Rita pill bottom-left

## Product rules for degraded states

- Empty state не должен выглядеть как “сломанная страница”.
- Если read-layer отвечает, но source data не видна, UI обязан явно говорить:
  - это visibility gap, а не просто пустой happy path
  - сколько source rows реально видно (`readEvidence`)
  - какое следующее действие у оператора
- Для bank degraded-state источник истины:
  - `readEvidence.recipesVisible`
  - `readEvidence.generatedVideosVisible`
  - `readEvidence.publicationsVisible`
- Для market degraded-state источник истины:
  - `readEvidence.metricsVisible`
  - `readEvidence.publicationsVisible`
  - `readEvidence.targetsVisible`

## Backend payload expectations

- `GET /api/factory/publishing-cockpit`
  - `mode`
  - `warnings`
  - `coverage`
  - `readEvidence`
  - `improvementLoop`
- `GET /api/factory/studio`
  - read-only source feed for bank/source visibility checks
- `GET /api/factory/learning`
  - read-only market/learning feed
- `GET /api/factory/status`
  - read-only schema/env readiness snapshot

## Current known gaps

- UI ещё не доведён до strict `1 in 1` against the external publishing handoff archive.
- Clean environment по-прежнему partial:
  - `factory_publications` missing
  - `factory_distribution_targets` missing
  - `post_metrics` visible only through partial/legacy path
- Поэтому текущий канон = owner archive + live route + этот doc + TSX implementation.
