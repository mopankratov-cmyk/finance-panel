# MiniMax Russian Voice Tuning

Date: 2026-07-01

Scope: paid MiniMax Speech-02 HD tuning batch only. No HeyGen render was run in this step.

Goal: make the MiniMax Russian voice less synthetic by lowering speed/pitch, adding pauses, and trying lower-energy emotional delivery.

## Listen Links

| Variant | Voice | Settings | Duration | URL | Local file |
|---|---|---|---:|---|---|
| `calm_speed090_pitch-1_neutral` | Calm_Woman | speed 0.90, pitch -1, neutral | 8.544s | https://v3b.fal.media/files/b/0aa07f0d/Hs9FyhNF5-NxetQ34xlzV_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/calm_speed090_pitch-1_neutral.mp3` |
| `calm_speed088_pitch-1_neutral` | Calm_Woman | speed 0.88, pitch -1, neutral | 8.232s | https://v3b.fal.media/files/b/0aa07f0d/gLnTdOSo-J1YhVwOLiXCm_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/calm_speed088_pitch-1_neutral.mp3` |
| `calm_speed090_pitch-2_surprised` | Calm_Woman | speed 0.90, pitch -2, surprised | 7.152s | https://v3b.fal.media/files/b/0aa07f0e/sM_qAw4ueY4WdIlHhRof9_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/calm_speed090_pitch-2_surprised.mp3` |
| `calm_speed092_pitch-2_neutral_shorter` | Calm_Woman | speed 0.92, pitch -2, neutral, simpler words | 6.912s | https://v3b.fal.media/files/b/0aa07f0e/tIzXOWsgQy7M8S6gvxm-1_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/calm_speed092_pitch-2_neutral_shorter.mp3` |
| `lively_speed090_pitch-1_neutral` | Lively_Girl | speed 0.90, pitch -1, neutral | 7.776s | https://v3b.fal.media/files/b/0aa07f0f/VIFFcMZSYYvopRt9TBHJE_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/lively_speed090_pitch-1_neutral.mp3` |
| `lively_speed088_pitch-2_neutral` | Lively_Girl | speed 0.88, pitch -2, neutral | 7.152s | https://v3b.fal.media/files/b/0aa07f0f/L6WxJjM2VX6pFVNP6VLPI_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax-tune/lively_speed088_pitch-2_neutral.mp3` |

## What Changed

- `speed`: reduced from baseline `0.94` to `0.88-0.92`.
- `pitch`: reduced to `-1` / `-2`.
- `pause`: increased to `0.45-0.50s`.
- `text`: added "если честно" in some variants to reduce presenter feel.
- `emotion`: kept mostly `neutral`; one `surprised` check.

## Next Step

Pick the least synthetic mp3 and send only that one to HeyGen as `audio_url` for a Madison lip-sync smoke.

