# Factory v2 M2 Clone Audit - Blueprint and Specialization

Date: 2026-06-28

## Scope

M2 removes the main reason batches look like clones: the generator must work from a per-SKU Blueprint, not from copied competitor text or a generic scenario template.

Implemented foundation:

- Blueprint schema and compiler;
- producer/scenario compatible Blueprint output;
- hook policy with locked hook source;
- scenario-quality pre-render gate for invalid Blueprint/hook;
- recipe transfer no longer copies competitor wording into prompt/onscreen text;
- canonical frame is required for paid product-lane Blueprint.

## Clone Rules

New autopilot recipes should satisfy:

- `blueprint.hook.locked=true`;
- `blueprint.hook.source=human|strong_prompt`;
- `blueprint.sku_id` matches article/product;
- beats reference canonical source;
- competitor examples may provide skeleton only, never verbatim text;
- weak hook rejects before paid render.

## Remaining Manual/Infra Work

- DB-level Blueprint persistence can be added later as a migration.
- Current safe rollout stores Blueprint in route payloads/contracts and can be wired into persistent recipe creation incrementally.

## Verification

- `lib/factory/blueprint/schema.test.mts`
- `lib/factory/producerBlueprintContract.test.mts`
- `lib/factory/hookPolicy.test.mts`
- `lib/factory/recipeTransferNoVerbatim.test.mts`

