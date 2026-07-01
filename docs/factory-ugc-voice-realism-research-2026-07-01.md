# UGC Voice Realism Research

- Date: 2026-07-01
- Goal: make Russian UGC voice sound maximally alive, not merely clean.
- Context: current Yandex 0.88 samples are understandable but still too synthetic/announcer-like.

## Executive Takeaway

The best path is not "tune Yandex until perfect".

For maximum realism, use a two-lane voice stack:

1. **Premium realism lane**: speech-to-speech / voice clone provider that preserves human timing and delivery.
2. **Reliable fallback lane**: Yandex/MiniMax tuned TTS for cheap baseline and batch exploration.

Yandex can become acceptable, but it is unlikely to become the main "living blogger" voice without a human performance layer.

## Why Current Audio Feels Synthetic

The synthetic feel usually comes from five things:

- Too-even rhythm: every phrase has the same energy and length.
- No micro-hesitation: real UGC has tiny stalls, restarts, uneven confidence.
- Text is written for ads, not for speech.
- Voice is too clean: no room context, no microphone character, no breath/fill.
- Lip-sync layer exposes the flatness: a clean TTS voice can feel worse when attached to a face.

## Provider Findings

### 1. ElevenLabs

Best candidate for premium realism.

Why:

- TTS is designed for nuanced intonation, pacing, and emotional awareness.
- Voice settings docs recommend a stable baseline around stability 50, similarity 75, style 0.
- Voice Changer / Speech-to-Speech can preserve emotion, timing, and delivery from input audio. This is likely the most important feature for "not AI".
- Russian is supported as a TTS language.

Best use:

- Record/produce rough human-like Russian delivery, then transform it into a consistent UGC blogger voice.
- Or clone a real approved voice and use TTS with careful text rewrites.

Risk:

- Needs account/key and paid tests.
- Pure TTS can still sound synthetic if text is stiff.

### 2. Cartesia Sonic

Strong candidate for fast and emotional API voice.

Why:

- Sonic 3.5 is positioned as high-naturalness, low-latency, emotive TTS.
- Supports Russian and voice cloning.
- Docs expose speed, volume, emotion controls and SSML control.
- Clone API supports `ru` as a language.

Best use:

- Test Russian clone/preset voices against ElevenLabs.
- Good candidate for production if it beats Yandex/MiniMax on "first 2 seconds".

Risk:

- Need key.
- Must verify Russian UGC quality directly; marketing claims are not enough.

### 3. MiniMax Speech-02 HD

Good fallback/experimental lane.

Why:

- Already tested through FAL.
- Supports speed/pitch/emotion/language boost.
- Pause markers like `<#x#>` are useful for making speech less machine-even.
- Voice cloning exists through some MiniMax integrations.

Best use:

- Continue as low-friction batch generator.
- Test cloned voice if access supports it.

Risk:

- Current samples may still sound synthetic.
- Word stress/pronunciation can be inconsistent.

### 4. Yandex SpeechKit

Reliable Russian baseline, not premium realism.

Why:

- Strong Russian pronunciation for many standard words.
- Supports Russian emotions, speed, SSML, and pronunciation control.
- Stable, cheap, predictable.

Best use:

- Baseline/fallback.
- Utility narration.
- Generate drafts before premium provider spend.

Risk:

- "Assistant/radio" fingerprint remains even after speed/SSML tuning.
- Some newer voices are unavailable through our current v1 account/key.

### 5. LMNT / Gradium / Soniox

Worth testing if keys are available.

Why:

- LMNT claims fast lifelike cloning from short samples and multilingual voices.
- Gradium and Soniox market real-time/voice-agent quality and may have stronger natural timing.

Best use:

- Provider bakeoff after ElevenLabs/Cartesia.

Risk:

- Russian UGC quality unknown until tested.

## Realism Strategy

### A. Stop Generating Full Scripts As One TTS Call

Use phrase-level synthesis:

- 1 phrase = 1 generation.
- Different pause/emotion/speed per phrase.
- Then assemble with controlled silences.

This avoids the smooth "one take by a robot" feel.

### B. Add Human Performance Layer

Most realistic option:

1. Generate or record a rough human performance.
2. Use speech-to-speech / voice changer to transfer it into the target voice.

This keeps:

- timing;
- hesitations;
- tiny unevenness;
- emotional curve.

TTS alone has to invent those; speech-to-speech preserves them.

### C. Use TTS-Optimized Copy, Not Ad Copy

Before generation, run a "spoken rewrite" agent:

- short clauses;
- fewer adjectives;
- no corporate words;
- phonetic product terms;
- intentional casual fillers, but not too many;
- emotional curve: doubt -> observation -> surprise -> recommendation.

Bad:

> Это инновационный продукт, который обеспечивает удобство использования.

Better:

> Я сначала вообще не поняла, зачем он нужен. Потом попробовала один раз и такая: ладно, теперь понятно.

### D. Post-Processing Chain

Use subtle processing, not "studio polish":

- loudness normalization per segment;
- gentle compression;
- small cut in harsh 2-4 kHz area if nasal/synthetic;
- phone/creator mic EQ preset;
- tiny room tone under the whole voice;
- controlled breath/noise before longer phrases;
- final limiter.

Important: too much cleanup makes AI more obvious. UGC should sound recorded, not sterile.

### E. Judge In Context

Do not evaluate mp3 alone.

Score in three contexts:

1. raw mp3;
2. mp3 over quiet room tone/music;
3. HeyGen lip-sync with avatar.

A voice that seems okay alone can fail on a face.

## Recommended Next Tests

### Test 1: ElevenLabs Speech-to-Speech

Input:

- one rough human-ish Russian performance;
- target voice candidate;
- 4 variants of stability/similarity/style.

Goal:

- preserve human rhythm and emotion.

Success:

- user does not think "TTS" in first 2 seconds.

### Test 2: Cartesia Russian Clone/Preset

Input:

- same script;
- same emotional curve;
- speed/emotion variants.

Goal:

- compare against ElevenLabs and Yandex 0.88.

### Test 3: Yandex Post-Processed Segment Assembly

Input:

- current best Yandex 0.88 candidate.

Variants:

- raw;
- normalized + silences;
- EQ/compression;
- EQ/compression + room tone.

Goal:

- see how far Yandex can go as fallback.

### Test 4: HeyGen Lip-Sync Reality Check

Take top 2 voices and run:

- same avatar;
- same 4-6 second script;
- no product.

Goal:

- pick the voice that survives the face.

## Scoring Rubric

Score each sample 1-10:

- naturalness;
- pronunciation;
- emotion;
- UGC believability;
- "AI smell" penalty;
- lip-sync fit.

Promote only if:

- naturalness >= 8;
- pronunciation >= 8;
- AI smell penalty <= 2;
- lip-sync fit >= 7.

## Decision

Yandex stays as fallback.

The main "living blogger" lane should be:

1. ElevenLabs speech-to-speech first;
2. Cartesia Sonic clone/preset second;
3. MiniMax clone/tuned third;
4. Yandex only as cheap baseline.

## Sources

- ElevenLabs Text to Speech docs: https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
- ElevenLabs Voice Changer docs: https://elevenlabs.io/docs/overview/capabilities/voice-changer
- ElevenLabs Speech-to-Speech API docs: https://elevenlabs.io/docs/api-reference/speech-to-speech/convert
- ElevenLabs Russian TTS: https://elevenlabs.io/text-to-speech/russian
- Cartesia Sonic docs: https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
- Cartesia speed/emotion docs: https://docs.cartesia.ai/build-with-cartesia/capability-guides/volume-speed-emotion
- Cartesia clone voice API: https://docs.cartesia.ai/api-reference/voices/clone
- Yandex SpeechKit synthesis docs: https://aistudio.yandex.ru/docs/en/speechkit/tts/request
- Yandex SpeechKit overview: https://aistudio.yandex.ru/docs/en/speechkit/tts/
- MiniMax Speech-02 HD on FAL: https://fal.ai/models/fal-ai/minimax/speech-02-hd
- MiniMax Speech-02 Replicate notes: https://replicate.com/blog/minimax-text-to-speech
- OpenAI TTS docs: https://developers.openai.com/api/docs/guides/text-to-speech
- Deepgram environment-aware TTS research: https://deepgram.com/learn/environment-aware-text-to-speech-research-deep-dive
