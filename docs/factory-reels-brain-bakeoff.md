# Reels Brain: provider bake-off and first corpus loop

Цель: выбрать реальные источники для корпуса `10k+` Reels/TikTok/Shorts не по обещаниям, а по измеряемому качеству.

## Что уже есть

- `POST /api/factory/reels-brain/bake-off` — report-only сравнение провайдеров.
- `POST /api/factory/reels-brain/manual-seed` — ручной seed ссылок.
- `POST /api/factory/reels-brain/source-run` — быстрый сбор через текущий `Virlo/Apify`.
- `POST /api/factory/reels-brain/analyze` — deep-enrich топ неразобранных роликов через `Virlo analyze_video`.
- `GET|POST /api/factory/reels-brain/patterns/build` — детерминированная сборка Pattern Memory из `viral_videos`.
- `POST /api/factory/reels-brain/loop` — первый one-click цикл: сбор → анализ → Pattern Memory.
- `GET /api/factory/reels-brain/corpus` — быстрый просмотр качества корпуса.
- `GET /api/factory/reels-brain/providers` — проверка настроенных источников без вывода секретов.

## Env

Минимум один источник:

```text
VIRLO_API_KEY
APIFY_TOKEN
YOUTUBE_API_KEY
BRIGHT_DATA_API_KEY
ENSEMBLEDATA_API_KEY
```

`YOUTUBE_API_KEY` также можно задать как `GOOGLE_YOUTUBE_API_KEY`.

Apify platform actors:

```text
APIFY_TIKTOK_ACTOR
APIFY_INSTAGRAM_REELS_ACTOR
APIFY_YOUTUBE_ACTOR
```

Bright Data uses official Web Scraper API datasets:

```text
BRIGHT_DATA_TIKTOK_DATASET_ID        # optional override, default gd_lu702nij2f790tmv9h
BRIGHT_DATA_INSTAGRAM_REELS_DATASET_ID # optional override, default gd_lyclm20il4r5helnj
BRIGHT_DATA_YOUTUBE_DATASET_ID       # optional override, default gd_lk56epmy2i5g7lzu0k
BRIGHT_DATA_INSTAGRAM_PROFILE_URLS   # comma/newline profile seeds for bright_instagram keyword-less mode
```

EnsembleData optional knobs:

```text
ENSEMBLEDATA_COUNTRY
ENSEMBLEDATA_TIKTOK_PERIOD   # default 90
ENSEMBLEDATA_TIKTOK_SORTING  # default 1 = most liked
ENSEMBLEDATA_YOUTUBE_PERIOD  # default month
ENSEMBLEDATA_YOUTUBE_SORTING # default views
```

Data365 пока не в первом контуре: если сервис недоступен, не блокируем сбор. Его можно добавить как отдельный provider позже, когда будет живой endpoint/key.

## Bake-off запросы

Стартовый набор из 30 запросов. По каждому провайдеру сравниваем `valid`, `withFollowers`, `withSound`, `avgScore`, дубли и top examples.

### Toys

```text
водяной пистолет обзор
детская игрушка распаковка
бластер тест
игрушка маркетплейс отзыв
летние игрушки дети
```

### Cosmetics

```text
санскрин тест
крем для лица отзыв
сыворотка до после
дешёвая косметика обзор
макияж находки маркетплейс
```

### Clothing

```text
куртка обзор
ветровка отзыв
что надеть осенью
маркетплейс одежда находки
пуховик тест
```

### Bags / accessories

```text
мини сумка обзор
что в сумке
аксессуары маркетплейс
сумка находка
капсула образ сумка
```

### Global English control group

```text
amazon finds review
tiktok made me buy it
viral skincare routine
water gun review
what fits in my bag
```

### Format control group

```text
before after product
unboxing viral product
pov product review
problem solution product
cheap vs expensive test
```

## Команды

Production endpoints под `/api/factory/*` закрыты. Для CLI smoke используй `CRON_SECRET` как Bearer-токен; браузерные вызовы из панели проходят через обычную `fp_session`.

Быстрый smoke без записи в БД:

```bash
CRON_SECRET=... node lib/factory/reelsBrainSmoke.mjs \
  --base-url https://finance-panel-two.vercel.app \
  --query "water gun review" \
  --limit 5
```

Report-only с явным списком источников:

```bash
CRON_SECRET=... node lib/factory/reelsBrainSmoke.mjs \
  --base-url https://finance-panel-two.vercel.app \
  --query "водяной пистолет обзор" \
  --providers apify_tiktok,youtube,bright_tiktok,ensemble_tiktok \
  --limit 10
```

Report-only:

```bash
curl -sS "$BASE_URL/api/factory/reels-brain/providers" \
  -H "Authorization: Bearer $CRON_SECRET"
```

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/bake-off" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "niche":"toys",
    "providers":["virlo","apify_tiktok","youtube","bright_tiktok","bright_youtube","ensemble_tiktok","ensemble_youtube"],
    "limit":20,
    "queries":["водяной пистолет обзор","детская игрушка распаковка","бластер тест"]
  }'
```

С сохранением в `viral_videos`:

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/bake-off" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "niche":"toys",
    "providers":["virlo","apify_tiktok","youtube","bright_tiktok","bright_youtube","ensemble_tiktok","ensemble_youtube"],
    "limit":30,
    "persist":true,
    "queries":["водяной пистолет обзор","детская игрушка распаковка","бластер тест"]
  }'
```

Instagram проверяется отдельно, потому что у Bright Data keyword-discovery для Reels нет в найденной официальной схеме: `bright_instagram` работает по profile/reel URL. EnsembleData умеет сначала искать Instagram users по тексту, потом тянуть их reels.

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/bake-off" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "niche":"toys",
    "providers":["apify_instagram","bright_instagram","ensemble_instagram"],
    "limit":20,
    "queries":["https://www.instagram.com/example_profile","детская игрушка"]
  }'
```

После сохранения:

```bash
curl -sS "$BASE_URL/api/factory/reels-brain/corpus?niche=toys&limit=50" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Deep analysis топа:

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/analyze" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"niche":"toys","limit":10}'
```

Pattern Memory:

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/patterns/build" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"niche":"toys","limit":300,"persist":true}'
```

One-click loop:

```bash
curl -sS -X POST "$BASE_URL/api/factory/reels-brain/loop" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "niche":"toys",
    "queries":["водяной пистолет обзор","детская игрушка распаковка","бластер тест"],
    "source_limit":20,
    "analyze_limit":8,
    "persist_patterns":true
  }'
```

## Как выбирать провайдера

Primary provider должен выигрывать по:

- `valid_rate >= 0.75`
- `withFollowers` высокий для outlier-score
- `withSound` высокий для TikTok/Reels насмотренности
- `avgScore` не ниже конкурентов
- мало дублей
- стабильный latency
- цена за 1000 clean records приемлемая

Backup provider выбирается не по среднему качеству, а по дополняемости: другая платформа, другие аккаунты, меньше дублей относительно primary.

## Первый production loop

```text
1. bake-off report-only на 30 запросах
2. выбрать primary/backup
3. bake-off persist=true на 5-10 лучших запросах
4. corpus?niche=... проверить качество
5. analyze top 50-100
6. patterns/build persist=true
7. niche-playbook/cached должен видеть обновлённую память
```

## Масштабирование к 10k

```text
30k-50k raw candidates
→ 10k clean viral corpus
→ 2k-3k caption/transcript analyzed
→ 500-1000 deep analyzed
→ 100-300 reusable patterns
```

Не анализировать все `10k` глубоко: сначала score, dedup, stratified sampling по платформам/нишам/форматам.
