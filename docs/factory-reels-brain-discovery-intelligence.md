# Reels Brain Discovery Intelligence

## Scope

This layer belongs to Reels Brain search intelligence, not to content generation.

It runs before expensive analysis and before Pattern Brain rebuilds. Its job is to decide where the system should search next so Apify/provider spend buys more relevant breakout videos and less noise.

## Workflow Position

```text
Discovery Intelligence
  -> source plan
  -> cheap source-run candidates
  -> relevance / breakout scoring
  -> source learning
  -> viral_videos
  -> Viewing Intelligence
  -> mp4 priority queue
  -> analyze backlog
  -> Pattern Brain
```

## Source Types

- `query`: search term.
- `hashtag`: platform hashtag.
- `account`: creator/profile to monitor.
- `sound`: audio/sound cluster.
- `manual_url`: operator seed.

## Learning Signal

Each source is scored by:

- `relevance_rate`: relevant videos / found videos.
- `breakout_rate`: breakout videos / relevant videos.
- `cost_per_relevant`: provider cost units / relevant videos.
- `yield_score`: combined score used for source ranking.

The goal is not to collect more videos. The goal is to reduce cost per useful, relevant, breakout candidate.

## Budget Lanes

- `explore`: try new queries/accounts/sounds.
- `exploit`: monitor proven high-yield sources.
- `refresh`: retest older sources so the map does not rot.

Default planning split is `20 / 70 / 10`.

## Current Implementation

State is stored inside `niche_playbooks.playbook.reels_brain_discovery` to avoid a database migration in the first iteration.

Main files:

- `lib/factory/reelsBrainDiscovery.ts`
- `app/api/factory/reels-brain/discovery/plan/route.ts`
- `app/api/factory/reels-brain/discovery/learn/route.ts`
- `lib/factory/reelsBrainDiscovery.test.mts`

## API

`GET /api/factory/reels-brain/discovery/plan?niche=ru_cosmetics&platform=tiktok`

Returns source-run payloads that can be executed by the existing source runner.

`POST /api/factory/reels-brain/discovery/learn`

Updates source memory after a run:

```json
{
  "niche": "ru_cosmetics",
  "platform": "tiktok",
  "type": "query",
  "value": "обзор косметики",
  "found": 100,
  "relevant": 42,
  "breakout": 18,
  "inserted": 30,
  "cost_units": 4
}
```

`GET /api/factory/reels-brain/discovery/replay?niche=ru_cosmetics&platform=tiktok&persist=true`

Replays Discovery Intelligence over already stored `viral_videos`.

It does not call Apify or external providers. It groups historical rows by `source_orbit_id` and repeated sounds, calculates relevance/breakout yield, and can persist top sources back into `reels_brain_discovery`.

Use it while provider balance is empty to prepare the source map before the next paid collection.

## Next Iteration

- Wire `discovery/plan` into daily learning jobs behind an explicit flag.
- Extract account candidates from good videos and learn them as `account` sources.
- Add author baseline collection for true `views / author_median_views` breakout scoring.
- Add UI block in `/agent/reels-brain` for source yield and planned next runs.

## Viewing Intelligence Upgrade

This is the layer that improves "насмотренность" without blindly buying more provider runs.

It answers one question:

> Which already found videos deserve expensive `.mp4`, audio, visual, and creative-brief analysis first?

Main files:

- `lib/factory/reelsBrainViewingIntelligence.ts`
- `app/api/factory/reels-brain/viewing-intelligence/route.ts`
- `lib/factory/reelsBrainViewingIntelligence.test.mts`

API:

`GET /api/factory/reels-brain/viewing-intelligence?niches=ru_toys,ru_clothing,ru_cosmetics&platforms=tiktok,instagram,youtube&limit_per_niche=500`

It is read-only. It does not call Apify. It does not download files. It ranks stored `viral_videos` rows and returns:

- `top_candidates`: best videos for media resolving and deeper analysis.
- `summary.resolve_mp4`: candidates worth trying through Apify media resolver.
- `summary.analyze_media`: candidates where direct media is already available.
- `summary.build_brief`: candidates ready for creative brief.
- `source_quality.best_sources`: queries/accounts/sounds that produce useful candidates.
- `source_quality.weak_sources`: sources to pause or reduce.

### The 8 Signals

1. `Relevance Scoring`

Checks whether the video belongs to the target Russian niche instead of being generic viral noise.

2. `Small Account Breakout`

Raises priority for videos where views are large relative to creator followers. These are valuable because the mechanic likely carried the video, not just the account size.

3. `Source Quality Memory`

Groups candidates by `source_orbit_id` so the system can learn which queries/accounts/sounds buy useful examples for less money.

4. `Creative DNA`

Extracts a lightweight atom set for every candidate: hook, emotion, camera, speech, B-roll, editing, and CTA.

5. `Anti-Pattern Brain`

Marks weak signals such as generic intros, missing views, very low virality, weak text signal, and possible AI slop.

6. `Per-Niche Brain`

Scores niche fit separately for toys, clothing, cosmetics, and future `ru_*` niches.

7. `Freshness / Growth Loop`

Gives extra weight to fresh candidates so the system does not learn only old viral history.

8. `Creative Brief Generator`

Creates a first draft for each useful reference: hook, retention mechanic, structure by seconds, visual recipe, product/theme fit, what to copy as mechanic, and what must not be copied.

### Operating Rule

Do not resolve every video.

The intended paid flow is:

```text
stored corpus
  -> viewing-intelligence
  -> high/medium candidates only
  -> Apify media resolver
  -> audio/visual analysis
  -> creative brief
  -> Pattern Brain / Anti-Pattern Brain
```

This reduces spend because metadata-only rows can be filtered before buying `.mp4`.
