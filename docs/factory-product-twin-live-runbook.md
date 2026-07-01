# Product Twin live runbook

## Цель

Собрать Product Digital Twin для выбранных SKU, сложить все большие ассеты в Yandex Disk и проверить результат в Product Twin Studio.

## Preconditions

- Ветка `feat/factory-v2-product-broll` влита в `main` и задеплоена.
- Production/Railway env содержит:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `FAL_KEY` или `FAL_BILLING_KEY`
  - `YANDEX_DISK_OAUTH_TOKEN`
- Product Twin Studio открывается: `/inferno/product-twins`.

## SKU batch

Текущий батч для дожима:

```bash
NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102
```

`NV-08` и `NV-836` уже собирались на production. `CLR001101` можно оставить в батче, если нужен fresh rebuild вместо старого twin.

## Step 1. Rebuild twins

Запускать в production/Railway окружении:

```bash
node --import tsx lib/factory/productTwinRebuildWorker.mjs \
  --articles NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102 \
  --build true \
  --apply-source-packs true \
  --batch-size 2
```

Ожидаемый результат:

- report: `docs/factory-product-twin-rebuild-report.json`;
- каждый successful item имеет `twin.twin_id`, `quality`, `source_path`;
- assets лежат в Yandex Disk под `content-factory/archive/.../product-twin/<article>/<twinId>/`;
- в Supabase `content_assets.disk = product_twin`.

## Step 2. Derive views

После successful rebuild:

```bash
node --import tsx lib/factory/productTwinDeriveViewsWorker.mjs \
  --articles NV-816,NV-01,CLR00716,CLR00715,CLR001101,CLR001102 \
  --generate true \
  --allow-synthetic true \
  --per-twin-limit 5 \
  --batch-size 1
```

Ожидаемый результат:

- report: `docs/factory-product-twin-derived-views-report.json`;
- view assets пишутся в `content_assets.analysis.product_twin_view_asset`;
- generated views архивируются в Yandex Disk в папку `views`.

## Step 3. Visual QA

В Product Twin Studio:

1. Нажать `Refresh`.
2. Нажать `Load Twins`.
3. Проверить карточки latest twin assets.

Минимальный acceptance:

- `clean_png`, `white_bg`, `gray_bg`, `shadow_bg`, `upscaled` открываются как картинки;
- `object_mask`, `alpha`, `depth_map`, `segmentation` присутствуют;
- товар не обрезан, не содержит рекламных плашек и чужого текста;
- для одежды clean asset не смешан с моделью/лицом/руками;
- для сумок сохранены форма, ручки/ремень, фурнитура и фактура;
- quality score не ниже `0.68`, кроме явно принятого вручную исключения.

## Failure handling

- `FAL_KEY не настроен`: запускать worker только в production/Railway env или подтянуть живой env.
- `download href` / `Yandex upload failed`: проверить `YANDEX_DISK_OAUTH_TOKEN`.
- `no source candidate`: сначала `Apply Packs` или `--apply-source-packs true`.
- Vercel 504 в UI `Rebuild`: не использовать UI для больших rebuild; запускать worker.
- Broken image preview в Studio: убедиться, что deploy содержит `product-twin/asset-preview`.
