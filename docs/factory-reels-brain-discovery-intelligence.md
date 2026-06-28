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
