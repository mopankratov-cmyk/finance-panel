# Seed Audio Repair Batch

Date: 2026-07-01

Scope: paid Seed Audio repair batch only. No HeyGen video was generated in this step.

Goal: fix word errors from the first Seed Audio smoke by forcing shorter exact-script generations.

## Result Summary

| Variant | Target | Duration | Local file |
|---|---:|---:|---|
| `v1_exact_original` | full exact script | 5.734875s | `/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v1_exact_original.mp3` |
| `v2_simpler_words` | full simplified script | 6.019625s | `/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v2_simpler_words.mp3` |
| `v3_first_phrase` | first phrase only | 3.255667s | `/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v3_first_phrase.mp3` |
| `v4_second_phrase` | second phrase only | 3.46375s | `/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v4_second_phrase.mp3` |

## Variants

### v1_exact_original

```json
{
  "request_id": "019f1d55-4d09-7101-8821-3e743a89957d",
  "audio_url": "https://v3b.fal.media/files/b/0aa07eb4/lPL4kX8srNjrGf8YW9jNX_speech.mp3",
  "duration": 5.734875,
  "file_size": 46316,
  "local_file": "/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v1_exact_original.mp3"
}
```

Prompt target:

```text
Я вообще не собиралась это пробовать. Но уже через пару секунд стало интересно.
```

### v2_simpler_words

```json
{
  "request_id": "019f1d55-502f-7470-bfbf-d55c60d9c10d",
  "audio_url": "https://v3b.fal.media/files/b/0aa07ebf/vI2uecUvzSE9H_pj5b5ZR_speech.mp3",
  "duration": 6.019625,
  "file_size": 48620,
  "local_file": "/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v2_simpler_words.mp3"
}
```

Prompt target:

```text
Я вообще не планировала это пробовать. Но через пару секунд стало интересно.
```

### v3_first_phrase

```json
{
  "request_id": "019f1d55-50f3-7ca3-a45a-2a1467774498",
  "audio_url": "https://v3b.fal.media/files/b/0aa07eb6/Bi0MrI12SkqBiXaHj5IR3_speech.mp3",
  "duration": 3.2556666666666665,
  "file_size": 26540,
  "local_file": "/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v3_first_phrase.mp3"
}
```

Prompt target:

```text
Я вообще не собиралась это пробовать.
```

### v4_second_phrase

```json
{
  "request_id": "019f1d55-51ba-7883-9607-953e10f22284",
  "audio_url": "https://v3b.fal.media/files/b/0aa07eb6/x9fbTJ0_jXjb6Y6cK0Dzl_speech.mp3",
  "duration": 3.46375,
  "file_size": 28268,
  "local_file": "/tmp/ugc-factory-heygen/seed-audio-repair-2026-07-01/v4_second_phrase.mp3"
}
```

Prompt target:

```text
Но уже через пару секунд стало интересно.
```

## QC Notes

- Local ASR/ffmpeg are not available in this environment, so word accuracy must be checked by listening.
- Recommended next step: listen to `v1` and `v2` first. If one is clean, send only that mp3 to HeyGen.
- If both full scripts still have word errors, use `v3 + v4` as two separate clips or concatenate outside Seed Audio before HeyGen.

