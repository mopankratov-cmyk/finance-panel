# Yandex SpeechKit Naturalize Batch

- Date: 2026-07-01
- Goal: reduce synthetic / announcer feel in Russian Yandex SpeechKit output.
- Scope: detached voice tuning only; no HeyGen lip-sync, no product, no main factory wiring.
- Key handling: SpeechKit credentials used only from temporary local dotenv in `/tmp`; no secrets committed.
- Output folder: `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize`

## Method

Changes from the first Yandex bakeoff:

- Shorter, more spoken script.
- Removed stiff wording and reduced punctuation pressure.
- Added SSML micro-pauses around thought turns.
- Lowered speed from the earlier `0.90-0.92` range to `0.86-0.88` for the main candidates.
- Kept only the strongest female candidates first: `alena`, `marina`, `jane`.

## Generated Files

- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/alena_plain_086.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/alena_ssml_088.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/marina_plain_086.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/marina_ssml_088.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/jane_plain_086.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/jane_ssml_088.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex-naturalize/jane_ssml_092.mp3`

## Current Hypothesis

For Yandex, the most realistic path is:

1. conversational rewrite before TTS;
2. SSML pauses for emotional turns;
3. speed around `0.86-0.90`;
4. segment-level synthesis instead of full-script synthesis;
5. optional post-processing outside SpeechKit: light loudness normalization, phone-like EQ, and very subtle room tone.

Yandex should be treated as a reliable Russian fallback/baseline. If the best tuned Yandex sample still feels synthetic, the next quality jump likely comes from ElevenLabs/Cartesia/LMNT rather than more Yandex parameter tuning.
