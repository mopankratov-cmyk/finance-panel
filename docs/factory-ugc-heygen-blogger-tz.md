# HeyGen-first UGC Blogger TZ

Дата: 2026-07-01
Статус: planning / implementation-ready
Scope: UGC contour, detached from main factory, no silent publish.

## Decision

HeyGen becomes the primary avatar provider for the UGC blogger contour.

Reason:

- Face quality and render stability are higher than the current Creatify/Tavus baseline.
- Native UGC feel can be recovered with correct look setup, short face time, and B-roll.
- Bad face quality is harder to fix downstream than a too-clean scene.

Creatify Camila stays as backup for raw UGC vibe. Tavus Gloria stays as natural-face fallback.

## HeyGen Model

HeyGen separates:

- `avatar_group`: character identity.
- `look id`: concrete outfit/pose/background/style.

For video generation we must pass the `look id` as `avatar_id`, not just the group id.

Creation paths:

1. `type: "photo"` via `POST /v3/avatars`
   - one portrait photo;
   - fastest custom blogger path;
   - no digital-twin consent flow according to HeyGen docs;
   - supports `motion_prompt` and `expressiveness` during video generation.

2. `type: "prompt"` via `POST /v3/avatars`
   - synthetic character from description;
   - can create new looks for an existing avatar by passing base `avatar_id`;
   - useful for casual room/outfit/look variations.

3. `type: "digital_twin"` via `POST /v3/avatars`
   - training video;
   - reusable digital twin;
   - requires consent flow for the avatar group.

Recommended path for us:

1. Start with `photo` avatar from a controlled portrait.
2. Generate 8-12 `prompt` looks from that base look.
3. Pick 2-3 strongest looks via first-2-second QC.
4. Only later consider `digital_twin` if photo avatar cannot reach realism target.

## Blogger Character Card

Working name: `Alina / UGC friend`

Role:

- not a presenter;
- not a beauty influencer;
- believable friend/reviewer;
- records short clips casually while checking something.

Age range:

- 25-34.

Voice:

- warm;
- slightly skeptical;
- low sales pressure;
- speaks like she is recording a note for a friend.

Personality:

- curious first;
- careful with claims;
- admits uncertainty;
- does not overpraise;
- notices practical details.

Backstory:

- lives in a normal apartment;
- buys ordinary marketplace products for herself/family;
- films quick checks before recommending anything;
- has a habit of saying what she would verify first;
- does not call herself an expert.

Forbidden style:

- corporate presenter;
- podcast desk;
- studio interview;
- perfect influencer smile;
- over-lit showroom;
- direct ad read.

## Base Portrait Requirements

If we create a photo avatar:

- front-facing portrait;
- shoulders visible;
- neutral or slight curious expression;
- no heavy makeup;
- no sunglasses;
- no hat covering forehead;
- natural daylight;
- simple background;
- no text/logos/brand marks;
- vertical crop preferred;
- image should look like a normal phone photo, not a polished studio headshot.

## Look Matrix

Create 8-12 looks from the same base identity.

Required looks:

1. Kitchen daylight, casual sweater, direct-to-camera.
2. Bedroom / mirror-side, soft cardigan, slightly closer crop.
3. Living room couch, hoodie, handheld/selfie feel.
4. Bathroom / skincare-safe room, robe/cardigan, no product visible.
5. Store aisle / shopping context, casual T-shirt.
6. Desk corner, no podcast mic, no monitor, no visible text.
7. Hallway / entryway, coat/cardigan, quick note style.
8. Window daylight close-up, minimal room detail.

Optional:

- outdoor balcony;
- car passenger seat, parked, daylight;
- neutral wall with household background.

Prompt rules for looks:

- ask for natural phone/selfie framing;
- avoid studio, podcast, office, microphone, laptop, whiteboard;
- request imperfect everyday lighting;
- request casual facial expression, not a big smile;
- keep background objects textless and brandless.

## Video Generation Settings To Test

For each candidate look:

- aspect ratio: `9:16`;
- resolution: `1080p` if allowed, else `720p`;
- face intro: target `2.0-2.5s`;
- expressiveness:
  - `medium` first;
  - `high` only if the face is too stiff;
- motion prompt:
  - `slight handheld selfie movement, small natural head nod, brief glance aside then back to camera`;
  - avoid big hand gestures until verified.
- voice settings:
  - speed `0.92-0.98`;
  - pitch `-1..0`;
  - volume default.

Script style:

- no product claims in face-only section;
- no "innovative", "must-have", "buy now";
- short, human, slightly uncertain.

Seed scripts:

1. `Wait, I almost missed this. This is the part I would check first.`
2. `I am not sure yet, but this detail made me stop.`
3. `Quickly, before I forget, this is what I would look at first.`
4. `I thought this would be obvious, but it actually surprised me.`
5. `Okay, this is the bit I wanted to see closer.`

## QC Rubric

Score every HeyGen render on:

- face quality;
- mouth rhythm;
- eye movement;
- blink naturalness;
- camera native feel;
- background native feel;
- first-2-sec AI detection;
- ad-speech risk;
- vertical/crop correctness.

Hard blockers:

- horizontal content inside vertical canvas;
- podcast / microphone scene;
- office presenter scene;
- readable/generated text in background;
- broken mouth/teeth artifacts;
- face intro longer than cap;
- product claim without B-roll proof.

Target:

- first-2-sec AI detection below `40`;
- mouth rhythm risk below `35`;
- native scene score above `70`;
- face section no longer than `2.5s`.

## Implementation Tasks

### HGN-001 Provider Capability Update

- Extend `lib/factory/heygen.ts` to cover:
  - `GET /v3/avatars/looks`;
  - `POST /v3/avatars`;
  - `GET /v3/avatars/{group_id}`;
  - `POST /v3/avatars/{group_id}/consent`;
  - `POST /v3/videos`;
  - `GET /v3/videos/{video_id}`.
- Store only sanitized status docs; never commit signed `video_url` query strings.

### HGN-002 Blogger Character Spec

- Add typed `HeyGenBloggerSpec`.
- Fields:
  - identity;
  - backstory;
  - speech style;
  - forbidden style;
  - look prompts;
  - QC thresholds.

### HGN-003 Avatar Creation Runbook

- Implement dry-run builder for:
  - photo avatar request;
  - prompt look generation request;
  - digital twin request;
  - consent request.
- No paid/live creation until owner confirms source portrait and consent path.

### HGN-004 Look Tournament

- Generate or select 8-12 HeyGen looks.
- Run 2.0-2.5s intro scripts.
- Save:
  - submit result;
  - status result sanitized;
  - local mp4;
  - screenshot slices;
  - QC verdict.

### HGN-005 Primary Blogger Memory

- Store selected:
  - avatar group id;
  - primary look id;
  - backup look ids;
  - voice id;
  - allowed scripts;
  - rejected looks with reasons.

### HGN-006 HeyGen-first Hybrid Pack

- Replace current `Creatify Camila` default with HeyGen primary.
- Keep fallback order:
  - HeyGen primary;
  - HeyGen backup look;
  - Creatify Camila;
  - Tavus Gloria.

## Open Questions

1. Do we create a fully synthetic prompt avatar first, or use a real/controlled portrait?
2. If using a real person, who owns consent and source footage?
3. Do we need Russian voice from HeyGen, external voice, or later dub?
4. Is the target blogger female-only, or do we create male/female pair?
5. Do we accept photo avatar quality, or go straight to digital twin after first test?

## Recommended Next Step

Create a synthetic HeyGen prompt-avatar first, because it avoids consent/real-person dependency and lets us test the look pipeline immediately.

Parallel path:

- prepare requirements for a real portrait/digital twin if synthetic quality is not enough.

