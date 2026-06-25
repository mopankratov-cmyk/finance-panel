# Factory Stabilization PR

## Summary

Stabilizes the AI content factory MVP around a single `graph-run` execution path, fail-open quality gates, observable execution logs, and repeatable stress reporting.

## What Changed

- Added architecture and execution docs:
  - `ARCHITECTURE_AUDIT.md`
  - `SYSTEM_EXECUTION_MAP.md`
  - `EXECUTION_OBSERVABILITY.md`
  - `STABILITY_REPORT.md`
- Simplified runtime orchestration around `graph-run`.
- Disabled or stubbed duplicate/optional MVP paths where they are not required for MP4 output.
- Hardened quality/OTK, learning, market metrics, observer, and lineage paths to fail open with warnings instead of blocking output.
- Added repeatable stress tooling and latest/history stress artifacts.
- Added factory regression guards for:
  - CLI timeouts
  - dependency cycles
  - jobs migration
  - market feedback
  - learning hints
  - generation history
  - node-preview history
  - graph-run clip history
  - learning API warnings
  - observer fail-open behavior
  - stress report contract

## Verification

```bash
npm run check:factory && git diff --check
```

Passes:

- `eslint`
- `tsc --noEmit`
- `npm run test:factory`
- `next build --webpack`
- `git diff --check`

Live production-like stress:

- base: `http://127.0.0.1:3012`
- recipe: `68`
- total runs: `10`
- completed: `10`
- failed: `0`
- run_fail: `0`
- timeouts: `0`
- avg duration: `19s`
- result: `stress_target_met: yes`

All 10 runs finished as `warning/done` because OTK score was below threshold (`6`). This is expected for Sprint 1 because the goal is stable MP4 output and OTK is intentionally fail-open.

## Notes

This PR intentionally does not optimize content quality or add new agents. The next milestone should be a separate quality sprint focused on raising OTK score without returning to fail-closed behavior.
