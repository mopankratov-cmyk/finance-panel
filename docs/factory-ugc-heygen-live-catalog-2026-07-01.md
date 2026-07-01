# HeyGen Live Catalog Scan

Date: 2026-07-01

Scope: read-only HeyGen scan with the owner-provided key. No paid generation, no upload, no avatar training, no secret persisted.

## Result

- `GET /v3/avatars`: OK, returned public avatar groups.
- `GET /v3/avatars/looks?ownership=public`: OK, returned public looks.
- `GET /v3/avatars/looks?ownership=private`: OK, returned 0 looks.
- `GET /v3/voices?engine=starfish`: OK, returned voices.
- `GET /v3/voices?language=ru`: OK, but mostly returned `Multilingual` voices.
- `GET /v3/voices?language=Russian`: OK, returned explicit Russian voices. Use this for Russian-only smoke tests.

## Selected Smoke Candidates

### Candidate A: Yoyo Madison + Anya

Recommended first smoke.

Reason: owner removed Caroline from the candidate line. Madison is the remaining portrait candidate for a Russian-only smoke; Anya stays as the selected Russian voice.

```json
{
  "name": "Yoyo Madison",
  "source": "existing_look",
  "avatarGroupId": "831259b0a4994475b1175ce9a17b463a",
  "avatarLookId": "f20cdc89e0ec4b61bbe453d73019a997",
  "voiceId": "37832e32d4f7475ab7a1cb0db8e5dd66",
  "language": "Russian",
  "defaultAspectRatio": "9:16",
  "identityHash": "54f50b281aac1edb"
}
```

Dry-run endpoint/body:

```json
{
  "endpoint": "/v3/videos",
  "method": "POST",
  "paid": true,
  "body": {
    "type": "avatar",
    "avatar_id": "f20cdc89e0ec4b61bbe453d73019a997",
    "title": "ugc-smoke-54f50b281aac1edb",
    "aspect_ratio": "9:16",
    "engine": "avatar_iv",
    "script": {
      "type": "text",
      "input": "Я вообще не собиралась это пробовать, но за первые пару секунд стало интересно. Delivery notes: natural UGC delivery, no presenter voice; tiny imperfections are allowed: micro-pauses, relaxed mouth movement, normal breathing; do not over-smile in the first two seconds; front phone camera feel, casual framing, non-perfect light; emotional beat: skeptical; speech speed: normal.",
      "voice_id": "37832e32d4f7475ab7a1cb0db8e5dd66"
    }
  }
}
```

### Excluded: Caroline

Owner decision: remove Caroline from the active candidate line. Do not run the next smoke on `Caroline_Kitchen_Standing_Side_public`.

## Noted Catalog Items

- Madison group: `831259b0a4994475b1175ce9a17b463a`
  - `f20cdc89e0ec4b61bbe453d73019a997`
  - `afba263cf6984b398f89296e953830b8`
  - `9297c2bab0844a68ad1c7ab6a87d86c8`
- Russian female voices found:
  - `37832e32d4f7475ab7a1cb0db8e5dd66` / Anya / female / Russian / supports pause
  - `70856236390f4d0392d00187143d3900` / Larisa Actrisa / female / Russian / supports pause
  - `aa28b796ef284c5a80497034afe9d93e` / Nadia / female / Russian / supports pause

Use `Anya` for the first Russian-only smoke, then compare with `Nadia` if the voice is too announcer-like.

## Next Action

Run one paid manual smoke for Candidate A (Yoyo Madison + Anya) only after explicit owner confirmation. Target: 3-4 seconds, no product, assess face/voice/first-two-seconds realism.
