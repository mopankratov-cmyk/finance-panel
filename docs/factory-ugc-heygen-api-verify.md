# HeyGen API Verification Notes

Date: 2026-07-01

Scope: UGC Factory sidecar only. No main factory wiring and no paid renders in this step.

## Verified Contract

- `GET /v3/avatars` lists avatar groups, meaning characters with one or more looks.
- `GET /v3/avatars/looks` lists concrete looks. The look `id` is the value to pass as `avatar_id` when creating a video.
- `GET /v3/voices` lists voices. For speech/TTS compatibility, `engine=starfish` is the relevant filter.
- `POST /v3/avatars` creates/trains avatars asynchronously. This is guarded behind explicit confirmation in code.
- `POST /v3/videos` creates avatar videos. This is guarded behind explicit paid confirmation in code.
- `GET /v3/videos/{video_id}` reads video status/details and is sanitized before exposing URLs.

## Implementation Decisions

- `lib/factory/heygen.ts` is a standalone sidecar client. It does not call `graph-run`, publishing, product-twin, or any main-factory route.
- `app/api/factory/heygen-readiness` defaults to dry readiness and only scans catalogs when called with `?live=1`.
- Video dry-runs require `avatarLookId`, not `avatarGroupId`, because the concrete blogger look is what renders.
- Paid operations are blocked by default:
  - avatar creation requires `confirmCreate=true`;
  - video creation requires `confirmPaid=true`.
- Signed media URLs are stripped to base URLs plus `*_present` booleans in status helpers.

## Next Epic 1 Tasks

1. Run live catalog scan with real `HEYGEN_API_KEY` and store sanitized sample IDs for Alina/Yoyo candidates.
2. Add UI picker that consumes `heygen-readiness?live=1` without storing secrets client-side.
3. Add a one-shot manual smoke button that creates a 3-4 second paid render only after explicit owner confirmation.
4. Record selected blogger look/voice as a stable identity card before any product/B-roll work.

## Identity Sidecar Added

- `lib/factory/heygenIdentity.ts` builds a stable blogger identity plan without writes.
- `app/api/factory/heygen-identity` validates identity cards and returns the required steps.
- Upload/mixed sources require `consentConfirmed=true`.
- Prompt/upload avatar creation and smoke video render remain plan steps only until explicit owner confirmation exists.

## Smoke Video Plan Added

- `lib/factory/heygenVideo.ts` builds a 3-4 second first-face smoke plan from a selected blogger identity.
- `app/api/factory/heygen-smoke` returns a dry-run `POST /v3/videos` body only; it never calls HeyGen.
- The smoke planner detects hard ad-style wording and applies small softening replacements before the first render review.
- Realism directives are attached to the script: phone-selfie framing, micro-pauses, normal breathing, no over-smiling in the first two seconds.

## Live Catalog Scan Added

- Sanitized scan saved in `docs/factory-ugc-heygen-live-catalog-2026-07-01.md`.
- Private looks returned 0 items, so the first smoke should use a public `existing_look`.
- Recommended first candidate: `Yoyo Madison` with `f20cdc89e0ec4b61bbe453d73019a997`.
- Caroline is excluded by owner decision; do not run the next smoke on `Caroline_Kitchen_Standing_Side_public`.
- Russian-only voice lookup must use `language=Russian`; `language=ru` mostly returns `Multilingual` voices.
- Recommended first Russian voice: `Anya` / `37832e32d4f7475ab7a1cb0db8e5dd66`.

## Paid Smoke Run Added

- One owner-approved paid smoke was run for Madison + Anya.
- Result saved in `docs/factory-ugc-heygen-smoke-madison-anya-2026-07-01.md`.
- HeyGen video id: `30b3d56545d64b1aa8a4941d8968126e`.
- Local mp4: `/tmp/ugc-factory-heygen/madison-anya-smoke-2026-07-01.mp4`.

## Seed Audio Lip-Sync Smoke Added

- One paid Seed Audio generation was run with `bytedance/seed-audio-1.0`.
- One paid HeyGen lip-sync smoke was run using the Seed Audio `audio_url`, without HeyGen TTS/Anya.
- Result saved in `docs/factory-ugc-heygen-smoke-madison-seed-audio-2026-07-01.md`.
- HeyGen video id: `81d9fc8cb27741bba983293c7c59d121`.
- Local mp4: `/tmp/ugc-factory-heygen/madison-seed-audio-smoke-2026-07-01.mp4`.

## Seed Audio Repair Batch Added

- Four short Seed Audio repair variants were generated, with exact-script prompts.
- No HeyGen render was run for the repair batch.
- Result saved in `docs/factory-ugc-seed-audio-repair-batch-2026-07-01.md`.
- Local folder: `/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/`.

## Russian Voice Provider Bake-Off Added

- MiniMax Speech-02 HD was tested via fal as the next likely Russian voice provider.
- Four MiniMax voices were generated: `Wise_Woman`, `Calm_Woman`, `Lovely_Girl`, `Lively_Girl`.
- Result saved in `docs/factory-ugc-russian-voice-provider-bakeoff-2026-07-01.md`.
- Local folder: `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax/`.

## MiniMax Voice Tuning Added

- Six MiniMax tuning variants were generated to reduce synthetic sound.
- Tuned dimensions: speed, pitch, pauses, emotion, and slightly more conversational wording.
- Result saved in `docs/factory-ugc-minimax-voice-tuning-2026-07-01.md`.
- Local folder: `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/`.
