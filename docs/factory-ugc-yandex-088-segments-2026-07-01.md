# Yandex 0.88 Segment Batch

- Date: 2026-07-01
- Goal: reduce synthetic feel after the user selected `0.88` as the promising speed.
- Scope: detached voice tuning only; no HeyGen lip-sync, no product, no main factory wiring.
- Output folder: `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments`

## Full Listen Files

These are simple mp3 concatenations of separately synthesized phrase parts:

- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/alena_088_segments_soft_full_concat.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/marina_088_segments_soft_full_concat.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/jane_088_segments_soft_full_concat.mp3`

## SSML Breath Files

- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/jane_088_ssml_breath.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-088-segments/alena_088_ssml_breath.mp3`

## Interpretation

The segment approach is useful if the single-pass SSML still feels too smooth or announcer-like. If the full concatenated files sound better but have rough joins, the next engineering step is proper audio post-processing:

- normalize each phrase to the same loudness;
- add controlled inter-phrase silence;
- export a clean final mp3/wav;
- optionally add light phone-like EQ and subtle room tone.
