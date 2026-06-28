# Factory v2 M4-M6 Runbook - Reliability, Learning, Autonomy

Date: 2026-06-28

## M4 Reliability

Code foundation:

- deterministic run idempotency key;
- DLQ action classifier;
- worst-case budget guard;
- worker handoff payload contract;
- graph-run plans include `idempotency_key`, `lane`, `lane_budget`.

Owner-gated work:

- queue table migration;
- Railway/VM worker deployment;
- secrets and env wiring;
- replay writer permissions.

## M5 Learning and Promotion

Code foundation:

- frames-grounded winner promotion contract;
- text/fallback/storyboard OTK cannot auto-promote;
- market signal requirement before winner promotion;
- batch planner waits for feedback every 5 runs.

Owner-gated work:

- post-publication metrics ingestion credentials;
- promotion destination policy;
- paid scaling budget thresholds.

## M6 Autonomous Planner

Code foundation:

- 50-run series planner;
- automatic hold on low pass-rate;
- automatic hold on budget block;
- batch size capped to 5 between feedback checkpoints.

Owner-gated work:

- multi-niche quota table;
- production scheduler ownership;
- final human override policy.

## Safe Operating Mode

Until M4 infrastructure is deployed, run the factory as:

1. guarded batch preflight;
2. prepare missing canonical sources;
3. run batches of 5;
4. inspect feedback/OTK summary;
5. only then run next 5.

Do not run a 50-video paid series without:

- canonical source coverage;
- budget guard green;
- frames-grounded OTK enabled;
- Telegram review path confirmed.

