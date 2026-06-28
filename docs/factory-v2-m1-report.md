# Factory v2 M1 Report - Product Lane Foundation

Date: 2026-06-28

## Scope

M1 makes the paid product lane honest before any attempt to scale volume.

Implemented foundation:

- canonical prepared frame contract: `720x1280`, contain/letterbox, no crop;
- no-FAL source-prep fallback also creates canonical media;
- source readiness tiers: `prepared`, `real`, `wb`, `none`;
- WB-only is weak source and must not pass `require_strong_source`;
- canonical-first asset binding;
- minimal render router with `product`, `ugc`, `hybrid` lanes;
- lane render budgets.

## Baseline KPI

Quality target is not "more generated files". M1 KPI is a truthful input:

- raw WB source must be blocked from paid i2v when strong source is required;
- each guarded product render must have canonical/prepared or real source;
- batch preflight must return `next_action: prepare_product` instead of silently rendering weak input.

## Top Risks

1. Existing legacy recipes may still have weak source. They should be re-prepared or left out of guarded paid runs.
2. Canonical source uses `content_assets.analysis` without migration; this is deliberate for safe rollout.
3. M1 does not solve clone quality. That belongs to M2 Blueprint/Specialization.

## Verification

- `lib/factory/canonicalFrame.test.mts`
- `lib/factory/sourceReadinessTierContract.test.mts`
- `lib/factory/assetBind.test.mts`
- `lib/factory/renderRouter.test.mts`

