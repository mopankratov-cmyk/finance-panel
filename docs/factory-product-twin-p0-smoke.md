# Product Twin P0 Smoke Report

Дата: 2026-06-30  
Ветка: `feat/factory-v2-product-broll`  
Scope: `TT04102` green water blaster + `YYS0101` YOYO sunscreen.

## 1. Что проверяли

Цель smoke: доказать, что первый слой Product Digital Twin v0 работает на реальных SKU:

```text
Yandex source
  -> clean source via FAL image edit
  -> local Product Twin asset pack
  -> b-roll prompts
  -> FAL image-to-video smoke
```

Полный route-smoke через deployed API пока заблокирован app-auth:

- `vercel curl https://factory-v2-product-broll.vercel.app/api/factory/product-twin/by-article/YYS0101`
- ответ: `{"error":"Не авторизовано"}`

Локально нет `SUPABASE_SERVICE_ROLE_KEY`, поэтому DB-персист `content_assets(disk='product_twin')` не запускался. Проверен живой генеративный контур без записи в БД.

## 2. Product Twin asset smoke

Локальные артефакты лежат в `tmp/product-twin-p0-smoke/` и не коммитятся.

### TT04102

Source:

- `/МАША/УЗИ зеленый/NEW светлая/2.png`

Result:

- `twin_id`: `pt_TT04102_754b78593905`
- clean URL: `https://v3b.fal.media/files/b/0aa05d88/bh6Ii-MVSjgh7NJPN6Q-F_hZxVjr9Z.png`
- assets:
  - `TT04102-clean_png.png`
  - `TT04102-white_bg.png`
  - `TT04102-gray_bg.png`
  - `TT04102-shadow_bg.png`
  - `TT04102-upscaled.png`

Visual verdict:

- Clean source is strong.
- Product shape, nozzle, handle, color zones, and printed graphics are preserved well.
- `shadow_bg` is suitable as first `broll_ready` candidate.

### YYS0101

Source:

- `/МАША/Крем-молочко YOYO/1.png`

Result:

- `twin_id`: `pt_YYS0101_37ce8f957c87`
- clean URL: `https://v3b.fal.media/files/b/0aa05d7b/6M2luamalE5Oozngefaw9_sIkrRIw8.png`
- assets:
  - `YYS0101-clean_png.png`
  - `YYS0101-white_bg.png`
  - `YYS0101-gray_bg.png`
  - `YYS0101-shadow_bg.png`
  - `YYS0101-upscaled.png`

Visual verdict:

- Clean source is usable, but too simplified.
- It preserved the YOYO mark and SPF text, but lost part of the original packaging richness.
- Needs stricter cosmetics identity prompt and a critic for "label/packaging detail loss".

## 3. B-roll smoke

Generated 4/4 mp4 results through FAL Kling from the clean source URLs.

### TT04102 videos

1. Water burst hook  
   `https://v3b.fal.media/files/b/0aa05d95/9EV0UEGNlneFl90z25lEe_output.mp4`

2. Backyard hero  
   `https://v3b.fal.media/files/b/0aa05d95/-HmvG50rkd6j7ZdLzQZER_output.mp4`

### YYS0101 videos

1. Macro texture hook  
   `https://v3b.fal.media/files/b/0aa05d9f/ztmKUmOtLy8o_jMxvwZqo_output.mp4`

2. Hand pickup  
   `https://v3b.fal.media/files/b/0aa05d95/cR6fmJuy8-cUx4_PCVvzJ_output.mp4`

## 4. Findings

### F1. Product Twin v0 contour works

The live no-DB smoke proved:

- source download from public Yandex works;
- FAL clean-source works;
- local asset pack generation works;
- b-roll prompts submit and return mp4.

### F2. Actual green UZI path was wrong in code

Code had:

```text
/МАША/УЗИ зеленый
```

Actual Yandex path is:

```text
/МАША/УЗИ зеленый
```

Fixed in `lib/factory/contentDisks.ts` and covered by `contentDisks.test.mts`.

### F3. Cosmetics clean-source needs stricter packaging preservation

For YOYO, the clean source is visually clean but too generic. Next prompt/gate should explicitly preserve:

- exact bottle proportions;
- all visible label blocks;
- logo position and scale;
- SPF/PA text;
- cap/body seam;
- original package material and color warmth.

### F4. Need DB/live route smoke after auth/env access

The deployed API exists and builds, but live route execution requires either:

- browser/app session;
- a service route bypass for internal factory smoke;
- or local `SUPABASE_SERVICE_ROLE_KEY`.

Do not weaken app auth globally. Add a narrow internal smoke mechanism only if approved.

## 5. Next tasks

## 5.1 Internal smoke route

После backend-добавок live smoke можно запускать без UI через защищённый route:

```text
GET /api/factory/product-twin/smoke
```

Режимы:

- `?build=1` — собрать/пересобрать P0 twins в БД.
- `?submit=1&count=1` — сделать платный b-roll submit через `twin_id` и вернуть `task_id`.
- `?apply=1` — применить Yandex archive batch для найденных generated/product-twin/prepared assets.

Smoke route защищён через существующий `CRON_SECRET`/Studio session auth. Внешний `vercel curl` без сессии ожидаемо получает `Не авторизовано`.

`POST /api/factory/product-twin/build` теперь имеет rebuild policy:

- по умолчанию переиспользует последний `ready` twin по `article`, если есть b-roll asset и служебный pack `object_mask`/`alpha`/`depth_map`/`segmentation`;
- `force:true` или `rebuild:true` явно запускает новую FAL clean/build цепочку;
- `min_quality`/`minQuality` задаёт нижний порог reuse.

`POST /api/factory/product-broll-batch` теперь закрепляет Product Twin как основной happy path:

- явный `twin_id` остаётся самым сильным source override;
- если передан только `article`, route сначала ищет latest ready Product Twin и берёт `broll_ready` asset;
- fallback на prepared/WB остаётся, но возвращает warning `product_twin not found`.

Автоматическая классификация Product Digital Twin:

```text
GET /api/factory/product-twin/classify?article=YYS0101
GET /api/factory/product-twin/classify?twin_id=pt_...
```

Ответ содержит `classification`: canonical asset по use-case (`hero`, `broll`, `ugc`, `marketplace`, `ads`), quality bucket, тип ассета, dominant color, object size, признаки packaging/hands и reject reasons. Это первый контракт этапа 6: downstream-агенты выбирают уже классифицированный twin, а не случайную картинку.

Asset pack v0 теперь включает служебные слои `object_mask`, `alpha`, `depth_map`, `segmentation`:

- строятся локально из clean asset;
- сохраняется в `content_assets` как отдельный `product_twin_asset`;
- получают `quality_details.object_coverage`, `alpha_coverage`, `depth_strategy` и список segments;
- не считаются `hero_ready`/`broll_ready`, но используются как служебный слой для будущего video/compositing pipeline.

0. Store generated media in Yandex Disk by default:
   - `falImageEdit` archives generated clean images;
   - `video-fal-status` archives completed FAL mp4;
   - `productTwinStore.uploadTwinAsset` archives generated twin variants;
   - batch archive now scans `content_assets` disks `gen`, `product_twin`, `prepared`;
   - if `YANDEX_DISK_OAUTH_TOKEN` is missing, generation stays fail-open and reports archive status instead of crashing.

1. Add Product Twin quality critic:
   - identity preservation;
   - label detail preservation;
   - background cleanliness;
   - b-roll readiness.

2. Improve cosmetics clean prompt:
   - preserve packaging detail more aggressively;
   - reject over-simplified bottle output.

3. Add `product-twin/build` smoke runner for internal use:
   - no global auth changes;
   - can run from worker/cron with existing secret.

4. Once DB smoke is possible:
   - build real `content_assets(disk='product_twin')` rows for `TT04102` and `YYS0101`;
   - run `/api/factory/product-broll-batch` with `twin_id`, not `image_url`.
