# Voice Telegram Review Loop

- Date: 2026-07-01
- Scope: detached UGC voice review loop; no main factory wiring yet.
- Goal: the system sends only the best voice shortlist to Telegram; the owner replies with numbers; the selection becomes a learning signal.

## UX

1. System sends one summary message:
   - batch id;
   - numbered shortlist;
   - instruction: reply `1` or `1,3`.
2. System sends each mp3 as Telegram audio:
   - caption contains `#voicebatch_<id>` and `#vN`;
   - inline button `✓ №N лучший`.
3. Owner chooses by number or button.
4. Webhook stores `cf_signals.event = voice_review_selected` best-effort:
   - `params.batch_id`;
   - `params.selected_indexes`;
   - `params.selected_candidate_ids`.

## Current Sender

Command:

```bash
node lib/factory/voiceTelegramReviewSend.mjs
```

Default shortlist:

- `alena_ssml_088`
- `jane_ssml_088`
- `alena_088_ssml_breath`
- `jane_088_ssml_breath`

The sender uploads local `/tmp` mp3 files directly to Telegram. This matters because Telegram cannot fetch local file paths by URL.

## Current Blocker

`FACTORY_TG_BOT_TOKEN` and `FACTORY_TG_CHAT_ID` are present as variable names locally/Vercel-side, but their pulled values are empty in the current environment. The code path is ready, but live Telegram delivery needs valid values restored.

## Next Step

After the owner picks one or more numbers, the next voice batch should be generated around those anchors through `lib/factory/voiceLearningLoop.ts`.

## Repair / Observability Endpoint

- `GET /api/factory/voice-review?batch_id=yandex088-r2`
  - returns recent `voice_review_selected` signals.
- `POST /api/factory/voice-review`
  - body: `{ "batch_id": "yandex088-r2", "selected_indexes": [1], "selected_candidate_ids": ["alena_ssml_088"] }`
  - records the same learning signal manually if a Telegram callback is missed.
