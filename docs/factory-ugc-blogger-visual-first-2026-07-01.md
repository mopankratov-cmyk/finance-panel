# UGC Blogger Visual-First Loop

- Date: 2026-07-01
- Goal: keep creating/validating bloggers while the final voice lane is unresolved.
- Scope: detached HeyGen/UGC blogger sidecar; no main factory wiring yet.

## Decision

Do not block blogger creation on perfect Russian audio.

The blogger contour now supports three voice modes:

- `visual_only` - default. Used to validate avatar look, framing, face realism, motion, and first-two-seconds impression without final audio.
- `heygen_tts` - temporary synthetic voice, useful for quick paid smoke checks.
- `external_audio` - later lip-sync from Unitool/Voicebox/Yandex/MiniMax/etc mp3.

## Why

The core UGC risk is not only voice. We still need to solve:

- avatar identity consistency;
- first-frame realism;
- camera/framing;
- non-presenter facial expression;
- repeatable blogger cards;
- look diversity across kitchen/bedroom/living room/etc.

Voice can be swapped later if the visual blogger is good.

## Implementation

- `lib/factory/heygenBlogger.ts`
  - added `voice.mode`;
  - added `voice.audioUrl`;
  - default config is now `visual_only`;
  - validation no longer requires `voice.voiceId` unless `voice.mode=heygen_tts`;
  - validation requires `voice.audioUrl` when `voice.mode=external_audio`.
- `lib/factory/heygenAgentTool.ts`
  - payload preview explicitly marks `visual_placeholder`;
  - supports `external_audio` payload shape.
- `lib/factory/heygenVideo.ts`
  - smoke planner can build visual-only plans without `voiceId`;
  - external audio mode requires `audioUrl`.
- `app/inferno/heygen-blogger/HeygenBloggerStudio.tsx`
  - smoke button now sends `voiceMode` and can operate as visual smoke.

## Next Tasks

1. Pick 2-3 avatar looks from HeyGen catalog for visual-only blogger cards.
2. Create stable cards:
   - `Alina` / mom-review;
   - `Yoyo` / young creator;
   - optional dad-review candidate.
3. Run visual-only smoke dry-runs for each.
4. If owner approves a visual candidate, run one paid short HeyGen smoke with temporary voice or external audio.
5. Only after visual candidate is good, plug in the voice lane.
