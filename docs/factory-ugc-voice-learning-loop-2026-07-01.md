# UGC Voice Learning Loop

- Date: 2026-07-01
- Scope: detached voice loop for UGC Factory sidecar; no main factory wiring yet.
- Goal: reduce synthetic feel until we have a repeatable voice preset that survives HeyGen lip-sync.

## Loop

1. Generate a small batch around one hypothesis.
2. Score each file by hand or later by panel:
   - naturalness;
   - pronunciation;
   - emotion;
   - UGC believability;
   - synthetic penalty.
3. Rank candidates with `lib/factory/voiceLearningLoop.ts`.
4. Generate the next batch around the best non-rejected anchor.
5. Promote only after a HeyGen lip-sync smoke with the chosen avatar.

## Current Anchor

The user selected `0.88` as the first promising Yandex speed. The next loop should compare:

- `alena_088_ssml_breath`;
- `jane_088_ssml_breath`;
- `alena_088_segments_soft_full_concat`;
- `jane_088_segments_soft_full_concat`;
- best MiniMax tuned sample from the previous batch.

## Quality Rule

Do not optimize for beauty. Optimize for "I did not instantly notice this was AI".

Promotion thresholds:

- score `>= 7.6`;
- synthetic penalty `<= 3`;
- pronunciation `>= 7`;
- no obvious word stress issue on the product/category words;
- acceptable lip-sync in HeyGen.

## Next Batch Policy

Change only one major axis per batch:

- speed: `0.86 / 0.88 / 0.90`;
- pauses: SSML micro-pauses vs segmented phrase synthesis;
- script: simpler spoken rewrite vs original UGC copy;
- post-processing: loudness, EQ, light room tone.

If Yandex keeps sounding synthetic after two anchored iterations, switch to ElevenLabs/Cartesia/LMNT for the premium voice lane and keep Yandex as reliable Russian fallback.
