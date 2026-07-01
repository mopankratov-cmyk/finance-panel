# Product Twin B-roll operator runbook

Дата: 2026-07-01.

Цель: первый реальный контур b-roll должен брать не WB-инфографику, а лучший Product Digital Twin asset.

## Источник

Приоритет источника для product b-roll:

1. `view_id` из derived views, если оператор явно выбрал ракурс.
2. `twin_id` и лучший `broll_ready` asset.
3. latest Product Twin по `article`.
4. `prepared`/WB fallback только если twin ещё не собран.

Общий автопилот (`assetBind`) теперь тоже видит `content_assets.disk = product_twin` как prepared-tier источник, если asset не service-map и подходит под b-roll/hero. Service assets (`object_mask`, `alpha`, `depth_map`, `segmentation`) не кормят i2v напрямую.

## Dry-run без оплаты

```bash
curl -sS -X POST "$BASE_URL/api/factory/product-broll-batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "article": "NV-08",
    "count": 3,
    "recipe": "apparel_motion",
    "model": "kling",
    "submit": false
  }'
```

Ожидаем:

- `mode = dry_run`;
- `source_kind = product_twin_latest` или `product_twin_view`;
- `twin_id` и `asset_id` заполнены;
- `variants[]` есть и промпты сохраняют identity товара.

## Платный smoke

Платный запуск только маленькими пачками:

```bash
curl -sS -X POST "$BASE_URL/api/factory/product-broll-batch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{
    "article": "NV-08",
    "count": 2,
    "recipe": "apparel_motion",
    "model": "kling",
    "submit": true
  }'
```

Правило: сначала 2 job на один артикул, затем визуальный QA, затем следующий артикул. Не запускать 8 SKU сразу.

## Yandex Disk

Большие ассеты должны оставаться в Yandex Disk. Если `source_image` возвращается как `yandex-disk:/...`, route перед submit вызывает `rehostImageForFal`, поэтому FAL получает временный fetchable URL. UI и отчёты должны показывать `preview_url`, а не raw pseudo-url.

## Acceptance

- Dry-run выбирает Product Twin перед prepared/WB.
- Submit требует явный `submit: true`.
- `FAL_KEY` или `FAL_BILLING_KEY` обязателен только для paid submit.
- Результаты после approve/archive уходят в Yandex Disk, а не раздувают Supabase Storage.
