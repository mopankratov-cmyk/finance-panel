# Reels Brain System Summary

## What This System Is

Reels Brain is the intelligence layer for the content factory.

Its job is not just to collect short-form videos. Its job is to build nasmotrennost: a structured memory of what works in TikTok, Instagram Reels, and YouTube Shorts, then turn that memory into usable creative briefs for future content generation.

The system is designed as a self-learning loop:

```text
Discovery Intelligence
  -> provider/source plan
  -> viral video collection
  -> raw video corpus
  -> analyze backlog
  -> Pattern Brain
  -> insight dashboard
  -> generator-ready creative briefs
  -> feedback and relearning
```

## Core Principle

The goal is not "more scraped videos".

The goal is cheaper and smarter discovery of relevant breakout videos:

- fewer random videos
- more videos from high-yield queries, accounts, sounds, hashtags, and manual seeds
- lower cost per useful analyzed reference
- clearer separation between platform-specific brains
- creative briefs that can be safely reused without copying original videos directly

## Main Layers

### 1. Discovery Intelligence

Discovery Intelligence decides where the system should search next.

It works before expensive analysis and before Pattern Brain rebuilds. This is the layer that should eventually make Apify/provider usage cheaper because the system learns which sources produce useful references.

Source types:

- `query`: search phrase
- `hashtag`: platform hashtag
- `account`: creator/profile to monitor
- `sound`: audio/sound cluster
- `manual_url`: operator seed

Main learning metrics:

- `relevance_rate`: useful videos / found videos
- `breakout_rate`: breakout videos / useful videos
- `cost_per_relevant`: provider cost / useful videos
- `yield_score`: combined source ranking score

Budget lanes:

- `explore`: test new sources
- `exploit`: reuse proven sources
- `refresh`: retest old sources so the map does not rot

Current default split: `20 / 70 / 10`.

### 2. Provider And Source Runner

The provider layer collects videos through external providers such as Apify and other API providers.

The system can compare providers by:

- volume found
- inserted videos
- relevance
- errors
- latency
- cost tier
- provider drift

Preferred provider memory is stored per platform/niche so TikTok, Instagram, and YouTube do not collapse into one generic short-video brain.

### 3. Raw Corpus

Collected videos are stored as raw references with metadata.

The corpus target currently discussed:

- first strong milestone: `6,000` videos
- full nasmotrennost milestone: `10,000` videos
- future serious scale: `100,000` videos, but only after Discovery Intelligence reduces waste

Default 10k allocation:

- TikTok: `4,000`
- Instagram: `3,500`
- YouTube Shorts: `2,500`

### 4. Analyze Backlog

Analyze backlog processes stored videos and extracts useful intelligence from them.

The backlog turns raw videos into structured observations:

- hook
- format
- retention mechanic
- topic/theme
- visual pattern
- likely niche fit
- virality signals
- platform signal

This layer is where "we collected video" becomes "we learned something from video".

### 5. Pattern Brain

Pattern Brain compresses analyzed videos into reusable patterns.

It learns:

- winning hooks
- repeated content structures
- retention mechanics
- visual recipes
- platform-specific differences
- cross-platform reusable ideas
- weak or noisy patterns that should not drive generation

Pattern Brain is not meant to store every detail forever. It stores compressed structures that are useful for future content decisions.

### 6. Insight Showcase

The Reels Brain dashboard is being simplified into an insight showcase instead of an operator control panel.

The user-facing goal:

- show what the brain understands
- show which hooks are winning
- show why the system trusts a pattern
- show what can be generated from a reference
- hide internal debugging unless needed

Current insight blocks:

- Brain status
- Learning economics
- Winning hooks
- Generator recipes
- Source references
- Source map
- Legal/safety guard
- 15-layer roadmap status

### 7. Creative Brief Conversion

Every strong reference should become a normal creative brief.

Creative brief fields:

- hook
- retention mechanic
- structure by seconds
- visual recipe
- what product/theme fits
- what we copy as a mechanic
- what is forbidden to copy

This is the bridge between Reels Brain and the future content generator.

The key rule: copy mechanics, not the original creative asset.

### 8. Generator Payload

The system now prepares generator-ready payloads from patterns.

Payload includes:

- source: `reels_brain_pattern`
- hook
- retention
- structure
- second-by-second plan
- visual recipe
- product fit
- copy-as-mechanic rules
- do-not-copy restrictions

This means the intelligence layer can later connect to the content factory without the generator needing to understand the whole scraping/analyze pipeline.

### 9. Learning Economics

Learning Economics explains whether the system is getting cheaper and smarter.

It should answer:

- how many videos were found
- how many were inserted
- how many were analyzed
- how many became useful patterns
- estimated spend
- estimated cost per analyzed video
- estimated cost per useful reference
- whether today is better than yesterday

Important limitation:

- current cost numbers are estimates unless provider billing API is connected
- true Apify spend per video needs provider billing data

### 10. Legal And Safety Guard

The legal/safety layer exists so references can be used safely.

It separates:

- reusable mechanics
- generic structure
- visual direction
- forbidden direct copying
- creator identity
- exact captions/scripts
- watermarked assets
- protected brand or face reuse

The target behavior: "inspired by pattern" instead of "copied from video".

## Current Storage Model

Current memory is mostly stored in existing content-factory data structures to avoid risky migrations.

Known memory areas:

- `viral_videos`: raw collected references and metadata
- analyzed video fields: extracted intelligence from backlog processing
- Pattern Brain structures: compressed patterns built from analyzed videos
- `niche_playbooks.playbook.reels_brain_sources`: preferred provider/source memory
- `niche_playbooks.playbook.reels_brain_discovery`: source yield and discovery learning memory
- automation history: recent runs and diagnostics

This is intentionally migration-light.

Future persistent tables may be useful when:

- source history becomes too deep for playbook JSON
- economics need exact long-term reporting
- feedback loops need publication outcomes
- graph-style exploration becomes important

## How The Daily Loop Should Work

Daily loop:

```text
1. Read current brain state.
2. Find weakest niche/platform lanes.
3. Ask Discovery Intelligence where to search next.
4. Run provider/source collection.
5. Insert useful raw videos.
6. Analyze backlog.
7. Rebuild or refresh Pattern Brain.
8. Update source memory and provider memory.
9. Show owner what improved.
```

If Apify balance is low:

```text
1. Stop expensive collection.
2. Replay Discovery Intelligence on already collected videos.
3. Improve source map without provider spend.
4. Resume paid collection only on higher-yield lanes.
```

## Platform Separation

TikTok, Instagram Reels, and YouTube Shorts should not share one flat brain.

Each platform can differ by:

- hook style
- pacing
- visual grammar
- caption density
- creator/account dynamics
- trend velocity
- search/query behavior
- retention mechanics

The system should maintain:

- TikTok brain
- Instagram brain
- YouTube Shorts brain
- cross-platform meta brain

Cross-platform ideas are useful, but they should be marked as transferable rather than blindly merged.

## Russian-Segment Focus

For Russian-language content, the brain should prefer Russian-language references and Russian-market patterns.

Reason:

- hooks differ by language
- humor differs
- trust signals differ
- marketplace/product expectations differ
- creator formats differ

Russian training should not be treated as a translation of global patterns. It needs its own source map and pattern memory.

## Dashboard UX Direction

The dashboard should become a clear insight room, not a settings room.

The owner should understand:

- how much the brain has learned
- which niches/platforms are strong or weak
- which hooks are winning
- why the system trusts them
- what references can become content
- whether collection is getting cheaper
- what stage comes next

The owner should not need to tune low-level settings manually in the UI. Most controls can stay internal or chat-driven.

## Current Status

Live or implemented foundation:

- platform-specific brain concepts
- raw corpus collection pipeline
- analyze backlog
- Pattern Brain generation
- Discovery Intelligence plan/learn/replay
- provider memory
- source map concept
- dashboard insight showcase
- creative brief structures
- generator-ready payloads
- learning economics estimates
- legal/safety guard
- 15-layer capability status

Still partial or planned:

- exact provider billing integration
- true cost per video from Apify billing
- publication feedback loop
- generator outcome scoring
- full source graph UI
- full account/sound discovery automation
- exact second-by-second extraction from video content
- long-term dedicated memory tables

## The 15 Active Improvement Layers

1. Reference-to-creative-brief conversion.
2. Hook confidence and evidence scoring.
3. OP / frequent / experimental hook segmentation.
4. Generator-ready payloads.
5. Dashboard insight filters.
6. Actual provider billing and cost-per-video truth.
7. Product/theme fit recommendations.
8. Source map and discovery economics.
9. Noise cleanup and low-quality pattern suppression.
10. Weekly owner report.
11. Publication feedback loop.
12. Generator integration.
13. Discovery autopilot.
14. Better video structure extraction.
15. Legal/safety guard v2.

## Best Next Steps

Short term:

- keep analyzing the existing corpus
- keep Russian-segment focus
- connect true Apify billing if possible
- improve insight dashboard readability
- make source map more visible

Medium term:

- connect Discovery Intelligence into daily jobs more aggressively
- add account and sound source learning
- start scoring generated content outcomes
- show which patterns produce better briefs

Long term:

- move from JSON/playbook memory to dedicated memory tables
- build a graph-style source and pattern explorer
- connect publication metrics back into learning
- scale toward `100,000` videos only after cost per useful reference is controlled

