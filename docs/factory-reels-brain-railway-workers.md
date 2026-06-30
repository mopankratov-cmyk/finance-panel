# Reels Brain Railway offline workers

Цель: вынести длинные циклы Reels Brain из Vercel request lifecycle в отдельный Railway worker.

Этот worker не связан с контент-заводом и не запускает генерацию роликов. Он только обслуживает слой интеллекта Reels Brain:

- анализирует уже собранный backlog `viral_videos`;
- классифицирует media asset readiness: direct asset / social page / unsupported;
- пересобирает `Pattern Brain` в `niche_playbooks`;
- обновляет digest/readiness surfaces;
- шлёт heartbeat в `/api/factory/worker-state`;
- по умолчанию не добирает новые видео и не тратит Apify.
- продолжает learning loop даже если heartbeat table ещё не применена в Supabase.

## Что запускается

Entrypoint:

```bash
node lib/factory/reelsBrainRailwayWorker.mjs
```

Railway config:

```text
railway.json
Dockerfile
```

One-shot smoke перед постоянным запуском:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
node lib/factory/reelsBrainRailwayWorker.mjs --once
```

## Railway env

Обязательные:

- `BASE_URL=https://finance-panel-two.vercel.app`
- `CRON_SECRET=...`

Рекомендуемые:

- `WORKER_ID=railway-reels-brain-offline`
- `WORKER_LABEL=Reels Brain Offline Workers`
- `REELS_BRAIN_NICHES=ru_toys,ru_clothing,ru_cosmetics`
- `REELS_BRAIN_PLATFORMS=tiktok,instagram,youtube`
- `REELS_BRAIN_LOOP_EVERY_SEC=600`
- `REELS_BRAIN_MAX_LANES=9`
- `REELS_BRAIN_ANALYZE_LIMIT=25`
- `REELS_BRAIN_PATTERN_LIMIT=3000`
- `REELS_BRAIN_MEDIA_RESOLVE_LIMIT=60`
- `REELS_BRAIN_BUILD_PATTERNS=true`
- `REELS_BRAIN_ENABLE_BULK=false`

## Cost guard

`REELS_BRAIN_ENABLE_BULK=false` означает:

- worker не вызывает paid corpus growth;
- Apify/Bright/Data providers не дергаются из Railway loop;
- worker работает только с уже собранными строками.

Включать добор корпуса можно только явно:

```bash
REELS_BRAIN_ENABLE_BULK=true
```

Это начнет дергать `/api/factory/jobs/reels-brain-cron?task=bulk...`, поэтому перед включением нужно проверить лимиты Apify.

## Текущий scope

Сейчас Railway worker закрывает operational offline loop:

1. `resolve media assets`
2. `analyze stored backlog`
3. `rebuild pattern memory`
4. `refresh portfolio digest`
5. `heartbeat/status`

Audio/visual heavy runtime подключается следующим слоем, когда появится стабильное хранение видеофайлов или signed download URL. Его нельзя честно делать только по URL карточки Reels, потому что для FFmpeg/Demucs/Librosa нужен доступ к media asset, а не только metadata.

Первый resolver уже работает в cost-safe режиме:

- `ready`: URL выглядит как прямой `mp4/mov/webm/audio` asset, можно отправлять в будущий FFmpeg/Whisper/visual worker;
- `metadata_only`: TikTok/Reels/Shorts page URL, оставляем в Pattern Brain до появления legal/signed media URL;
- `unknown`: host не распознан, нужен manual/provider resolver review;
- `blocked`: битый URL.

## Guardrails

- не вызывать `produce`, `scenario`, `director`, `publish`;
- не генерировать сценарии или видео;
- не публиковать контент;
- не копировать чужие кадры/аудио;
- не хранить секреты в репозитории;
- не включать paid bulk без явного env.

## Как проверить

Локально:

```bash
node --check lib/factory/reelsBrainRailwayWorker.mjs
node --import tsx lib/factory/reelsBrainRailwayWorkerContract.test.mts
```

Railway deploy uses the root `Dockerfile` so the service starts the worker process directly instead of falling back to `npm start`.

Production smoke:

```bash
BASE_URL=https://finance-panel-two.vercel.app \
CRON_SECRET=... \
node lib/factory/reelsBrainRailwayWorker.mjs --once
```

После smoke открыть:

```text
https://finance-panel-two.vercel.app/api/factory/worker-state
```

В UI должен появиться worker `railway-reels-brain-offline`.

Если `/api/factory/worker-state` отвечает `table_missing`, применить миграцию:

```text
supabase/migrations/20260624_factory_railway_worker_state.sql
```

До применения этой миграции worker всё равно продолжит анализ backlog и пересборку Pattern Brain; не будет работать только красивый heartbeat в UI.
