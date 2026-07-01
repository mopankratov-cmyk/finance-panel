# Yandex SpeechKit RU Voice Smoke

- Date: 2026-07-01
- Goal: test Yandex SpeechKit as a Russian UGC voice fallback/provider.
- Scope: detached voice bakeoff only; no HeyGen lip-sync, no product, no main factory wiring.
- Runner: `node lib/factory/yandexSpeechkitSmoke.mjs`
- Optional dotenv override: `--dotenv=/path/to/env`
- Output folder: `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex`

## Provider Notes

- Official v1 endpoint: `https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize`.
- v1 accepts URL-encoded `text` or `ssml`, `lang=ru-RU`, `voice`, `emotion`, `speed`, and `format=mp3`.
- Russian voices to test first:
  - `marina` / `friendly` / `0.92`
  - `alena` / `good` / `0.90`
  - `dasha` / `good` / `0.92`
  - `masha` / `friendly` / `0.90`
  - `lera` / `neutral` / `0.88`

## Current Status

Live smoke completed.

Local `.env.production.local` contains empty SpeechKit values, and Vercel has the variable names but pulled values are empty. A valid SpeechKit key and folder id were recovered from local Codex state and used through a temporary dotenv file only.

## Generated Files

- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/marina_friendly_092.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/alena_good_090.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/jane_good_092.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/jane_neutral_090.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/omazh_neutral_090.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/ermil_good_092.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/zahar_good_092.mp3`
- `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex/filipp_neutral_090.mp3`

## Rejected Defaults

The first pass showed that this account/key rejects some newer voices through the v1 endpoint:

- `dasha`: `Unsupported voice is requested`
- `masha`: `Unsupported voice is requested`
- `lera`: `Unsupported voice is requested`

The runner default list was updated to voices that completed successfully with the current account.

## Command

```bash
YANDEX_SPEECHKIT_API_KEY='...' \
YANDEX_SPEECHKIT_FOLDER_ID='...' \
node lib/factory/yandexSpeechkitSmoke.mjs
```

If the account uses an IAM token instead of an API key:

```bash
YANDEX_SPEECHKIT_IAM_TOKEN='...' \
YANDEX_SPEECHKIT_FOLDER_ID='...' \
node lib/factory/yandexSpeechkitSmoke.mjs
```

## Acceptance

- Generate 5 mp3 files in `/tmp/ugc-factory-voice-bakeoff-2026-07-01/yandex`.
- User listens and labels each voice as `natural`, `tts-ish`, or `reject`.
- Winner gets one HeyGen lip-sync smoke with Madison/Anya-style avatar candidate.
