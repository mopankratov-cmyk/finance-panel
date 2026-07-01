# HeyGen Smoke: Madison + Seed Audio

Date: 2026-07-01

Scope: one paid Seed Audio generation plus one owner-approved paid HeyGen lip-sync smoke. Russian language only, no product, no B-roll, no factory publish.

## Seed Audio Input

Model: `bytedance/seed-audio-1.0` on fal.

```json
{
  "prompt": "Сгенерируй короткую естественную русскую речь обычной девушки для UGC-видео. Не диктор, не реклама, как будто она записывает на телефон и чуть сомневается: \"Я вообще не собиралась это пробовать. Но за первые пару секунд стало интересно.\" Голос живой, разговорный, с небольшой паузой после первой фразы.",
  "output_format": "mp3",
  "sample_rate": 24000,
  "speed": 0.96,
  "volume": 1,
  "pitch": 0
}
```

Seed result:

```json
{
  "request_id": "019f1d4d-de47-7d73-ae53-0793e3709b17",
  "audio_url": "https://v3b.fal.media/files/b/0aa07e84/MmKyyQq48ERtTJf4caNGa_speech.mp3",
  "content_type": "audio/mpeg",
  "file_size": 118508,
  "duration": 14.748333333333333,
  "sample_rate": 24000,
  "local_audio_file": "/tmp/ugc-factory-heygen/seed-audio-russian-ugc-2026-07-01.mp3"
}
```

## HeyGen Input

```json
{
  "type": "avatar",
  "avatar_id": "f20cdc89e0ec4b61bbe453d73019a997",
  "title": "ugc-smoke-madison-seed-audio-2026-07-01",
  "aspect_ratio": "9:16",
  "resolution": "720p",
  "output_format": "mp4",
  "audio_url": "https://v3b.fal.media/files/b/0aa07e84/MmKyyQq48ERtTJf4caNGa_speech.mp3",
  "expressiveness": "low"
}
```

## HeyGen Result

```json
{
  "video_id": "81d9fc8cb27741bba983293c7c59d121",
  "status": "completed",
  "duration": 14.808,
  "video_page_url": "https://app.heygen.com/videos/81d9fc8cb27741bba983293c7c59d121",
  "local_video_file": "/tmp/ugc-factory-heygen/madison-seed-audio-smoke-2026-07-01.mp4",
  "local_video_file_bytes": 8521706
}
```

## Notes

- This run does not use HeyGen TTS or Anya. HeyGen only performs avatar animation and lip sync from `audio_url`.
- `Idempotency-Key` was used for the HeyGen mutation: `ugc-smoke-madison-seed-audio-2026-07-01-v1`.
- HeyGen signed media URL was not saved in the repo.
- Seed Audio output URL is public fal media and was saved because it is the reusable generated audio input.

## Manual QC To Fill

- Seed Audio naturalness:
- Voice accent/pronunciation:
- Lip sync:
- Face realism over 14.8 sec:
- Compared with Anya:
- Verdict:

