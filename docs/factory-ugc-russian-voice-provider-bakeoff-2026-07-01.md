# Russian Voice Provider Bake-Off

Date: 2026-07-01

Goal: find the best Russian voice layer for UGC videos before sending more audio to HeyGen.

## Current Ranking Hypothesis

1. **MiniMax Speech-02 HD via fal** — best immediate candidate because it supports exact text, `language_boost=Russian`, pauses, emotions, and voice controls. We can test it now with the existing FAL key.
2. **ElevenLabs** — likely top-tier realism and cloning, but no usable key is configured in this runtime.
3. **Yandex SpeechKit** — likely strong Russian pronunciation/stress, but may sound more assistant/narrator than UGC. No key configured.
4. **HeyGen Russian voices** — clean words, easy video path, but baseline Anya may sound TTS/dictor-like.
5. **Seed Audio 1.0** — expressive, but failed our current word-accuracy/voice-quality bar.

Sources checked:

- fal MiniMax Speech-02 HD API: `fal-ai/minimax/speech-02-hd`
- fal Seed Audio 1.0 API: `bytedance/seed-audio-1.0`
- HeyGen v3 voices/videos already tested live
- ElevenLabs Russian TTS pages/docs
- Yandex SpeechKit voice list/request docs

## MiniMax Live Batch

Model: `fal-ai/minimax/speech-02-hd`

Text:

```text
Я вообще не собиралась это пробовать. <#0.35#> Но уже через пару секунд стало интересно.
```

Common settings:

```json
{
  "output_format": "url",
  "language_boost": "Russian",
  "voice_setting": {
    "speed": 0.94,
    "vol": 1,
    "pitch": 0,
    "emotion": "neutral"
  },
  "audio_setting": {
    "sample_rate": 24000,
    "bitrate": 128000,
    "format": "mp3",
    "channel": 1
  }
}
```

Note: fal docs display these audio enum values as strings, but live API required numeric `sample_rate`, `bitrate`, and `channel`.

## Listen Links

| Provider | Voice | Duration | URL | Local file |
|---|---:|---:|---|---|
| MiniMax Speech-02 HD | Wise_Woman | 6.48s | https://v3b.fal.media/files/b/0aa07ef2/z5vRpN0DQZ1SH_3UiiSZz_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax/Wise_Woman.mp3` |
| MiniMax Speech-02 HD | Calm_Woman | 7.272s | https://v3b.fal.media/files/b/0aa07ef2/gDd2BlXZhtQXbCRchQFs4_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax/Calm_Woman.mp3` |
| MiniMax Speech-02 HD | Lovely_Girl | 7.944s | https://v3b.fal.media/files/b/0aa07ef3/qnilnqMNgvMthy6DD4YG7_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax/Lovely_Girl.mp3` |
| MiniMax Speech-02 HD | Lively_Girl | 6.744s | https://v3b.fal.media/files/b/0aa07ef3/-ZiLo75iHESkAwyzfGS8Q_speech.mp3 | `/tmp/ugc-factory-voice-bakeoff-2026-07-01/minimax/Lively_Girl.mp3` |

## QC Rubric

Rate each voice 1-5:

- Word accuracy: no substitutions, no weird stress.
- UGC naturalness: sounds like a person filming on phone, not a narrator.
- Age/fit: believable for Yoyo/Alina persona.
- Emotion: slight skepticism + curiosity.
- HeyGen suitability: stable enough for lip-sync, no excessive pauses/noise.

## Next Step

Pick the best MiniMax mp3. Send only the winner to HeyGen as `audio_url` for one Madison lip-sync smoke.

If none are good enough, next provider to test is ElevenLabs once `ELEVENLABS_API_KEY` is configured.

