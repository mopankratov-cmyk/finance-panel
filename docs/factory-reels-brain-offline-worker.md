# Reels Brain Offline Worker

Статус: `live-ready`

Цель: поднять offline-контур для `media locators`, когда обычные провайдеры находят Instagram/TikTok/YouTube видео, но не отдают прямой `video_url`.

Это не новый сборщик корпуса. Это worker для уже собранных `viral_videos`, который:

- берет свежие rows без `media_locator_candidates`;
- дергает `GET /api/factory/jobs/reels-brain-media-backfill`;
- при наличии локального resolver-а (`yt-dlp`) помогает добить прямой media URL;
- затем чередует `media` и `audio` циклы, чтобы те же rows переходили в `audio_extracted` и `transcript_ready`;
- шлет heartbeat в `/api/factory/worker-state`.

## Что уже есть в коде

- Worker CLI: [lib/factory/reelsBrainOfflineWorker.mjs](/Users/maksimpankratov/Projects/finance-panel/finance-panel/lib/factory/reelsBrainOfflineWorker.mjs)
- Media backfill route: [app/api/factory/jobs/reels-brain-media-backfill/route.ts](/Users/maksimpankratov/Projects/finance-panel/finance-panel/app/api/factory/jobs/reels-brain-media-backfill/route.ts)
- yt-dlp resolver helper: [lib/factory/reelsBrainMediaResolver.ts](/Users/maksimpankratov/Projects/finance-panel/finance-panel/lib/factory/reelsBrainMediaResolver.ts)

## Railway env

Минимум:

```bash
BASE_URL=https://finance-panel-two.vercel.app
CRON_SECRET=...
REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER=1
REELS_BRAIN_MEDIA_BACKFILL_PROVIDER=apify_instagram
REELS_BRAIN_MEDIA_BACKFILL_PLATFORM=instagram
REELS_BRAIN_PLATFORMS=tiktok,instagram,youtube
REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM=bright_instagram
REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK=apify_tiktok
REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE=apify_youtube
REELS_BRAIN_MEDIA_BACKFILL_LIMIT=3
REELS_BRAIN_MEDIA_BACKFILL_SCAN=30
REELS_BRAIN_OFFLINE_MODE=mixed
REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC=240
REELS_BRAIN_AUDIO_BACKFILL_LIMIT=2
REELS_BRAIN_AUDIO_BACKFILL_SCAN=18
REELS_BRAIN_OFFLINE_HEARTBEAT=1
WORKER_ID=reels-brain-mixed-worker
WORKER_LABEL=Reels Brain Mixed Worker
WORKER_TASK_ID=RB-MIXED-001
WORKER_TASK_TITLE=Media and audio backfill loop
```

## Команда запуска

One-shot:

```bash
node lib/factory/reelsBrainOfflineWorker.mjs --once --provider apify_instagram --platform instagram --limit 3 --scan 30 --use-local-resolver 1
```

Daemon:

```bash
node lib/factory/reelsBrainOfflineWorker.mjs --every-sec 240 --mode mixed --platforms tiktok,instagram,youtube --media-limit 3 --media-scan 30 --audio-limit 2 --audio-scan 18 --use-local-resolver 1
```

Если нужен Bright Data вместо Apify:

```bash
node lib/factory/reelsBrainOfflineWorker.mjs --every-sec 180 --provider bright_instagram --platform instagram --limit 3 --scan 30 --use-local-resolver 1
```

## Что должен уметь Railway runtime

Нужен установленный `yt-dlp`.

Проверка:

```bash
yt-dlp --version
```

Если `yt-dlp` нет, worker все равно будет работать, но только в provider-mode. Тогда он сможет enrich-ить metadata, но `media_locator_candidates` могут остаться пустыми.

## Как понять, что все ок

1. `GET /api/factory/jobs/reels-brain-media-backfill?...` перестает возвращать только `matched_with_media: 0`.
2. В ответе появляются:
   - `rows_with_media > 0`
   - `used_local_resolver: true` хотя бы на части rows
3. В `GET /api/factory/reels-brain/learning-economics` начинает расти:
   - `audio_visual_readiness.with_media_locators`
   - `audio_visual_readiness.ready_for_worker`

## Рекомендуемый порядок

1. Запустить one-shot на `limit=2` или `limit=3`.
2. Проверить JSON-ответ.
3. Если `used_local_resolver` и `rows_with_media` пошли вверх, переводить worker в mixed-daemon.
4. Mixed worker дальше сам чередует:
   - `media` tick
   - `audio` tick
   - transcript enrichment
   - и вращает платформы по кругу `tiktok -> instagram -> youtube`
5. После накопления `audio_ready` слоя переходить к следующему углублению:
   - beat / speech features
   - stronger audio patterns
   - publication feedback loop

## Текущее live-наблюдение

На production-проверке:

- `apify_instagram` и `bright_instagram` матчат нужные Instagram posts;
- но прямой `video_url` через provider response не отдают;
- значит для Instagram offline/media слоя сейчас нужен именно local resolver, а не еще один обычный scraper provider.
