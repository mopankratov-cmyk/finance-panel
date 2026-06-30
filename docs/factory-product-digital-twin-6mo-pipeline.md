# Product Digital Twin OS: 6-Month Build Pipeline

Дата: 2026-06-30  
Статус: рабочая программа для Factory v2  
Цель: за 6 месяцев перестроить контент-завод с генерации из сырых картинок на генерацию из цифрового двойника товара.

## 0. Северная идея

Контент-завод не должен начинать с вопроса "какую картинку отдать в генератор".

Он должен начинать с объекта:

```text
Product Digital Twin
├── canonical truth assets
├── derived production assets
├── synthetic views
├── segmentation/depth/masks
├── metadata
├── prompt library
├── usage policy
└── performance memory
```

Дальше все агенты работают не с исходной фотографией, а с `twin_id`.

## 1. Главные принципы

1. Truth и synthetic не смешиваются.
   - `truthful` = очищенная/нормализованная версия реального исходника.
   - `derived` = производный ассет без изменения формы товара.
   - `synthetic` = модель додумала ракурс, руку, интерьер, использование.

2. Сначала стабильность товара, потом ширина.
   - Ракурсы, UGC и lifestyle имеют смысл только после clean/mask/upscale слоя.

3. Каждый ассет получает назначение.
   - Не просто файл, а `hero_ready`, `broll_ready`, `ugc_ready`, `marketplace_safe`, `ads_safe`.

4. Платная генерация идёт после gate.
   - Сырой WB/Yandex исходник не должен напрямую попадать в image-to-video.

5. Один SKU превращается в медиа-актив.
   - Подготовил twin один раз, потом используешь в карточках, Reels, Shorts, TikTok, UGC, баннерах и рекламе.

## 2. Целевая схема

```text
Source Images
  ↓
Source Candidate Picker
  ↓
Clean + Repair + Normalize
  ↓
Canonical Product Twin
  ↓
Asset Pack
  ↓
Derived Assets
  ↓
Synthetic Views
  ↓
B-roll / Hero / Marketplace / UGC / Ads
  ↓
Publishing
  ↓
Metrics + Learning Loop
  ↓
Next Better Batch
```

## 3. Базовые сущности

### ProductTwin

```ts
type ProductTwin = {
  twin_id: string;
  article: string;
  product_name: string;
  category: "cosmetics" | "toy" | "apparel" | "bag" | "other";
  source_set_id: string;
  canonical_asset_id: string;
  status: "building" | "ready" | "needs_review" | "failed";
  quality_score: number;
  prompt_library: ProductPromptLibrary;
  metadata: ProductTwinMetadata;
  created_at: string;
  updated_at: string;
};
```

### ProductAsset

```ts
type ProductAsset = {
  asset_id: string;
  twin_id: string;
  article: string;
  url: string;
  kind:
    | "original"
    | "clean_png"
    | "transparent_png"
    | "white_bg"
    | "black_bg"
    | "gray_bg"
    | "shadow_bg"
    | "reflection_bg"
    | "upscaled"
    | "object_mask"
    | "alpha"
    | "depth_map"
    | "segmentation"
    | "detail_crop"
    | "synthetic_angle"
    | "lifestyle"
    | "hero"
    | "broll_source"
    | "ugc_source";
  truth_level: "truthful" | "derived" | "synthetic";
  angle: "front" | "left_45" | "right_45" | "top" | "bottom" | "detail" | "unknown";
  quality_score: number;
  hero_ready: boolean;
  broll_ready: boolean;
  ugc_ready: boolean;
  marketplace_safe: boolean;
  ads_safe: boolean;
  has_hand: boolean;
  has_packaging: boolean;
  dominant_colors: string[];
  risk: "low" | "medium" | "high";
};
```

### Prompt Library

```ts
type ProductPromptLibrary = {
  preserve_identity: string;
  negative_identity: string;
  clean_source: string;
  broll_motion: string[];
  hero_shot: string[];
  marketplace_card: string[];
  ugc_scene: string[];
};
```

## 4. 6-месячный план

## Месяц 1: Canonical Twin v0

Цель: перестать использовать сырые картинки как вход в генерацию.

### M1.1 Product Twin Build API

Создать:

- `POST /api/factory/product-twin/build`
- `GET /api/factory/product-twin/[twin_id]`
- `GET /api/factory/product-twin/by-article/[article]`

Вход:

```json
{
  "article": "YYS0101",
  "product": "YOYO sunscreen",
  "category": "cosmetics",
  "disk_path": "/МАША/Крем-молочко YOYO/1.png"
}
```

Выход:

```json
{
  "ok": true,
  "twin_id": "pt_YYS0101_...",
  "status": "ready",
  "canonical_asset_id": "...",
  "assets": {
    "clean_png": "...",
    "white_bg": "...",
    "transparent_png": "..."
  }
}
```

### M1.2 Source Candidate Picker

Задача:

- собрать все исходники SKU из Yandex Disk, WB, prepared, uploaded;
- оценить каждый источник;
- выбрать лучший source для clean-source;
- не брать инфографику, если есть более чистый исходник.

Критерии source score:

- товар занимает 35-85% кадра;
- нет крупной инфографики;
- товар не обрезан;
- нормальная резкость;
- нет рук, если это не intentional UGC-source;
- упаковка/лейбл видимы.

Acceptance:

- для `TT04102` выбирается чистый бластер из `/МАША/УЗИ зеленый/NEW светлая/2.png`;
- для `YYS0101` route умеет стартовать с `/МАША/Крем-молочко YOYO/1.png`;
- raw infographic не идёт напрямую в b-roll.

### M1.3 Clean + Repair + Normalize

Задача:

- удалить фон;
- удалить инфографику;
- восстановить края товара;
- центрировать объект;
- нормализовать цвет;
- создать canonical clean PNG.

Использовать текущий фундамент:

- `product-clean-source`;
- `falImageEdit`;
- `buildProductCleanPrompt`;
- category-specific preservation prompts.

Acceptance:

- clean source не содержит людей, иконок, EAC-бейджей, рекламных плашек;
- форма товара не изменилась;
- важный текст упаковки сохранён, если он часть товара;
- `quality_score >= 0.75` для P0 SKU.

### M1.4 Asset Pack v0

Создать минимальный pack:

```text
clean_png
transparent_png
white_bg
gray_bg
shadow_bg
upscaled
object_mask
```

Acceptance:

- каждый asset имеет `asset_id`;
- каждый asset связан с `twin_id`;
- b-roll больше не принимает `image_url` как основной happy path, только `twin_id` или explicit override.

## Месяц 2: Quality, Masks, Depth, Classifier

Цель: сделать twin не просто набором картинок, а машинно-понятным объектом.

### M2.1 Asset Quality Critic

Оценивать:

- резкость;
- JPEG-артефакты;
- сохранение формы;
- читаемость лейбла;
- наличие лишних объектов;
- crop/центрирование;
- пригодность к video generation.

Выход:

```json
{
  "quality_score": 0.86,
  "identity_preservation": 0.91,
  "background_cleanliness": 0.95,
  "label_readability": 0.78,
  "risk": "low",
  "reject_reasons": []
}
```

Acceptance:

- плохие clean assets не попадают в `broll_ready`;
- route возвращает `needs_review`, если все assets ниже порога.

### M2.2 Segmentation Pack

Создать:

- object mask;
- alpha channel;
- segmentation map;
- approximate depth map;
- bounding box;
- object area ratio.

Acceptance:

- mask визуально совпадает с товаром;
- transparent PNG строится из mask/alpha, а не из промпта наугад;
- metadata содержит `object_bbox` и `object_area_ratio`.

### M2.3 Metadata Classifier

Для каждого ассета определить:

- angle;
- type;
- dominant colors;
- has packaging;
- has hand;
- has text;
- product size in frame;
- hero ready;
- UGC ready;
- b-roll ready;
- marketplace safe;
- ads safe.

Acceptance:

- `ProductTwin` можно запросить и получить список best assets by use-case;
- `broll-batch` выбирает asset через `broll_ready=true`.

### M2.4 Prompt Library v0

Автоматически собрать:

- identity preservation prompt;
- negative prompt;
- clean prompt;
- b-roll prompts by category;
- hero prompts by category.

Acceptance:

- prompt library хранится в twin;
- b-roll route использует `twin.prompt_library.preserve_identity`.

## Месяц 3: B-roll Machine on Twin

Цель: все product videos строятся поверх twin.

### M3.1 B-roll Batch by twin_id

Новый happy path:

```json
{
  "twin_id": "pt_TT04102_...",
  "recipe": "toy_action",
  "count": 10,
  "submit": true
}
```

Задача:

- убрать зависимость от сырого `image_url`;
- выбирать лучший `broll_ready` asset;
- rehost только выбранный asset;
- записывать provenance: `video -> twin -> asset -> prompt`.

Acceptance:

- каждый b-roll job знает `twin_id` и `asset_id`;
- rejected video можно объяснить через asset/prompt/model;
- для P0 SKU generated batch стабильнее текущего image_url flow.

### M3.2 Video Quality Critic for Product Identity

Проверять:

- не изменилась ли форма товара;
- не расплылся ли лейбл;
- не появился ли чужой объект;
- не потерялся ли товар;
- не стало ли слишком AI/slop.

Acceptance:

- ролики с деформацией товара получают reject до попадания в approved;
- critic пишет `identity_failure_reason`.

### M3.3 Motion Recipe Library

Категории:

- cosmetics: macro, hand pickup, vanity orbit, texture, shelf hero;
- toy: splash, backyard, hand grab, action ready, feature detail;
- apparel: fabric detail, try-on proxy, hanger, flatlay, motion fold;
- bag: table hero, zipper detail, hand carry, interior reveal.

Acceptance:

- recipe выбирается по category;
- prompt не предлагает skincare-сцену для toy;
- P0 batch содержит минимум 5 разных motion types.

## Месяц 4: Derived Assets + Marketplace/Hero Layer

Цель: twin начинает обслуживать не только видео, но и весь визуальный слой товара.

### M4.1 Derived Asset Generator

Создать:

- hero shot;
- marketplace card source;
- neutral studio;
- premium studio;
- product on table;
- product in interior;
- detail crops;
- ad-safe clean creative.

API:

```text
POST /api/factory/product-twin/derive
```

Acceptance:

- каждый derived asset имеет `truth_level="derived"`;
- marketplace-safe assets не содержат синтетических ракурсов;
- hero assets проходят quality score.

### M4.2 Marketplace Card Pipeline

Задача:

- готовить изображения под карточки маркетплейса;
- не искажать товар;
- не использовать risky synthetic view;
- добавлять background/lighting только вокруг товара.

Acceptance:

- есть `marketplace_safe=true` набор;
- карточка не содержит недостоверных деталей товара;
- можно выбрать top-3 card candidates на SKU.

### M4.3 Product Twin Gallery UI

Минимальный UI:

- список twins;
- страница twin;
- asset grid;
- фильтры by kind/use-case/risk;
- кнопка build derived;
- кнопка send to b-roll.

Acceptance:

- оператор может увидеть, почему asset выбран;
- можно вручную approve/reject asset.

## Месяц 5: Synthetic Views + UGC Creator Army

Цель: расширить визуальный мир товара и подключить UGC, не ломая правду SKU.

### M5.1 Synthetic View Generator

Создать:

- 45 left;
- 45 right;
- top;
- detail close-up;
- product in hand;
- product in use;
- opened packaging only if category allows.

Правило:

```json
{
  "truth_level": "synthetic",
  "risk": "medium",
  "marketplace_safe": false,
  "ads_safe": true,
  "broll_ready": true
}
```

Acceptance:

- synthetic assets никогда не маркируются `marketplace_safe=true` без ручного approve;
- consistency critic сравнивает synthetic view с canonical asset.

### M5.2 UGC Scene Builder on Twin

Сущность:

```text
UGC Scene
├── creator persona
├── product twin
├── hook
├── script
├── product interaction
├── b-roll inserts
├── voice/subtitles
└── final short
```

Задача:

- UGC scripts используют product metadata;
- сцены берут product-in-hand / b-roll assets из twin;
- avatar/lip-sync не является обязательным P0;
- сначала UGC-like product scenes, потом face/avatar.

Acceptance:

- один twin может породить 5 UGC scene variants;
- каждая сцена имеет `creator_persona_id`;
- video provenance содержит `twin_id`.

### M5.3 Creator Persona Library

Создать:

- persona types by category;
- tone of voice;
- allowed claims;
- hook style;
- risk policy.

Acceptance:

- cosmetics не делает запрещённых medical claims;
- toy не обещает невозможных свойств;
- persona не перетягивает внимание с товара.

## Месяц 6: Learning Loop + Content Company OS

Цель: система учится, какие twins/assets/prompts/scenes реально работают.

### M6.1 Performance Memory

Связать:

```text
post/video
  → twin_id
  → asset_id
  → prompt_id
  → recipe_id
  → model
  → platform metrics
```

Метрики:

- views;
- watch rate;
- completion;
- saves;
- clicks;
- orders if available;
- manual winner/loser;
- quality score.

Acceptance:

- можно ответить: какой asset дал лучший результат по SKU;
- можно ответить: какой motion recipe работает по категории;
- winner не определяется только views без качества.

### M6.2 Next Batch Recommender

Генерировать решения:

- use asset X more;
- stop using prompt Y;
- try more macro details;
- avoid hand scenes for this SKU;
- generate more hero shots;
- rebuild twin, source quality too low.

Acceptance:

- next batch создаётся на базе winners/losers;
- есть weekly plan by SKU;
- повторяются не ролики, а winning patterns.

### M6.3 Operator Dashboard

Панели:

- twin readiness;
- asset quality distribution;
- b-roll pass rate;
- UGC pass rate;
- cost per approved asset;
- cost per approved video;
- top winning assets;
- broken twins requiring rebuild.

Acceptance:

- оператор видит, какие SKU готовы к масштабированию;
- система не генерит дальше по SKU с broken twin.

## 5. Месячные milestones

| Месяц | Результат | Главный acceptance |
|---|---|---|
| M1 | Canonical Twin v0 | P0 SKU имеют clean/transparent/white/shadow/upscaled/mask |
| M2 | Classifier + masks/depth | b-roll выбирает asset по metadata, а не по сырому URL |
| M3 | B-roll on twin_id | каждый ролик связан с twin/asset/prompt |
| M4 | Derived assets | twin генерит hero/marketplace/lifestyle candidates |
| M5 | Synthetic + UGC | UGC сцены строятся на twin, synthetic не смешан с truth |
| M6 | Learning OS | next batch строится на performance memory |

## 6. P0 SKU scope

Первые SKU:

1. `TT04102` — green water blaster.
   - Category: `toy`.
   - Первичный сценарий: action b-roll.
   - Clean-source candidate: `/МАША/УЗИ зеленый/NEW светлая/2.png`.

2. `YYS0101` — YOYO sunscreen.
   - Category: `cosmetics`.
   - Первичный сценарий: skincare ritual b-roll.
   - Source candidate: `/МАША/Крем-молочко YOYO/1.png`.

P0 не расширяется на новые SKU, пока:

- twin build success rate < 80%;
- b-roll identity pass rate < 60%;
- нет ручной галереи review;
- нет provenance `video -> twin -> asset`.

## 7. API map

```text
POST /api/factory/product-twin/build
GET  /api/factory/product-twin/[twin_id]
GET  /api/factory/product-twin/by-article/[article]
POST /api/factory/product-twin/rebuild
POST /api/factory/product-twin/derive
POST /api/factory/product-twin/synthetic-views
POST /api/factory/product-twin/approve-asset
POST /api/factory/product-broll-batch
POST /api/factory/ugc-scene/build
GET  /api/factory/product-twin/performance
```

## 8. Storage layout

```text
factory-media/
  product-twins/
    {article}/
      original/
      canonical/
      masks/
      backgrounds/
      derived/
      synthetic/
      broll/
      ugc/
      reports/
```

## 9. Quality gates

### Twin Ready Gate

Twin is ready only if:

- canonical clean exists;
- transparent exists;
- object mask exists;
- quality score >= 0.75;
- identity preservation >= 0.8;
- no high-risk artifacts;
- at least one `broll_ready` asset exists.

### Marketplace Safe Gate

Marketplace-safe only if:

- truth_level is `truthful` or approved `derived`;
- no synthetic angle;
- no changed label;
- no invented product feature;
- no unsupported claim.

### B-roll Ready Gate

B-roll-ready only if:

- product occupies visible area;
- background is clean or intentionally scene-ready;
- alpha/mask exists when useful;
- preservation prompt exists;
- asset risk is not high.

### UGC Ready Gate

UGC-ready only if:

- product identity is stable;
- hand/use scene is category-appropriate;
- claims policy exists;
- synthetic risk is accepted for ads/UGC.

## 10. Metrics

North Star:

```text
approved_content_per_ready_twin
```

Supporting metrics:

- twin build success rate;
- clean-source acceptance rate;
- average asset quality score;
- b-roll identity pass rate;
- cost per ready twin;
- cost per approved video;
- generated variants per SKU;
- winner rate by asset kind;
- rebuild rate;
- manual review rate.

6-month target:

- twin build success rate >= 85%;
- b-roll identity pass rate >= 70%;
- at least 20 approved assets per ready SKU;
- at least 10 approved short-form videos per ready SKU;
- every approved video has provenance to twin/asset/prompt.

## 11. Risks and decisions

### Risk: trying to build too much in M1

Decision:

- M1 only canonical truth assets.
- No synthetic angles until M5.

### Risk: synthetic views hallucinate product details

Decision:

- synthetic assets are never source of truth;
- `marketplace_safe=false` by default;
- manual approve required for high-risk use.

### Risk: cost explosion

Decision:

- no fan-out until Twin Ready Gate passes;
- monthly caps by SKU;
- reuse assets aggressively.

### Risk: model lock-in

Decision:

- store asset provenance and model;
- API returns semantic asset kinds, not provider-specific fields.

### Risk: operator cannot trust automation

Decision:

- every asset has explainable score and reject reasons;
- UI supports manual approve/reject;
- system shows why it picked an asset.

## 12. First implementation slice

Самый первый PR после текущего `product-clean-source` и `product-broll-batch`:

```text
Product Twin v0
├── lib/factory/productTwin.ts
├── lib/factory/productTwinStore.ts
├── lib/factory/productTwinQuality.ts
├── app/api/factory/product-twin/build/route.ts
├── app/api/factory/product-twin/by-article/[article]/route.ts
└── lib/factory/productTwin.test.mts
```

Scope:

- build twin from `image_url` or `disk_path`;
- call clean-source;
- create minimal asset pack: clean, white, shadow;
- store metadata in existing `content_assets.analysis` first, without DB migration;
- let `product-broll-batch` accept `twin_id`.

Acceptance:

- `TT04102` and `YYS0101` each produce a `twin_id`;
- b-roll batch can use `twin_id`;
- no raw infographic source reaches paid video generation in happy path.

