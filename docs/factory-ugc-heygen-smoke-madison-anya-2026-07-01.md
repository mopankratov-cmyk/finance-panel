# HeyGen Smoke: Madison + Anya

Date: 2026-07-01

Scope: one owner-approved paid HeyGen smoke. Russian language only, no product, no B-roll, no factory publish.

## Input

```json
{
  "type": "avatar",
  "avatar_id": "f20cdc89e0ec4b61bbe453d73019a997",
  "title": "ugc-smoke-madison-anya-2026-07-01",
  "aspect_ratio": "9:16",
  "resolution": "720p",
  "output_format": "mp4",
  "script": "Я вообще не собиралась это пробовать. Но за первые пару секунд стало интересно.",
  "voice_id": "37832e32d4f7475ab7a1cb0db8e5dd66",
  "voice_name": "Anya",
  "voice_language": "Russian",
  "voice_settings": {
    "speed": 1,
    "pitch": 0,
    "volume": 1
  },
  "expressiveness": "low"
}
```

## Result

```json
{
  "video_id": "30b3d56545d64b1aa8a4941d8968126e",
  "status": "completed",
  "duration": 5.27673,
  "video_page_url": "https://app.heygen.com/videos/30b3d56545d64b1aa8a4941d8968126e",
  "local_file": "/tmp/ugc-factory-heygen/madison-anya-smoke-2026-07-01.mp4",
  "local_file_bytes": 3777741
}
```

## Notes

- The request used the current v3 Create Video schema: top-level `script` and `voice_id`.
- An `Idempotency-Key` was used for the paid mutation: `ugc-smoke-madison-anya-2026-07-01-v1`.
- The signed media URL was not saved in the repo.
- `ffmpeg/ffprobe` are not available in this environment, so local frame extraction was not performed.

## Manual QC To Fill

- Face realism first 2 seconds:
- Russian voice naturalness:
- Lip sync:
- UGC vs presenter feel:
- Verdict:

