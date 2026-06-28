# Factory v2 M3 Gate Report - QA Before Assembly

Date: 2026-06-28

## Scope

M3 moves quality checks earlier in the pipeline and makes final approval honest.

Implemented foundation:

- in-process artifact and video critic functions;
- graph-run no longer calls `artifact-check` / `video-critic` routes in the main OTK path;
- `clip-qa` step runs before assembly;
- broken clips can trigger culprit regen before final assembly;
- OTK gate modes: `shadow`, `block_broken`, `strict`;
- default gate is `block_broken`;
- `approved` signal is tied to frames-grounded pass;
- Rubric v2 axes with backward compatibility:
  - `hook`;
  - `scrollStop`;
  - `retention`;
  - `aiSlop`;
  - `productVisibility`;
  - `conversion`.

## Expected Outcome

- 0 route-to-route 508 in QA path;
- broken generated clips do not proceed to assembly;
- text/fallback OTK cannot masquerade as true winner;
- regen targets the weakest v2 axis.

## Verification

- `lib/factory/qaGates.ts`
- `lib/factory/clipQaStepContract.test.mts`
- `lib/factory/otkGateRampContract.test.mts`
- `lib/factory/rubricV2Contract.test.mts`

