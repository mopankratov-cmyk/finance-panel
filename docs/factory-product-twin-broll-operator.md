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

Важно: `shadow_bg`, `white_bg` и `gray_bg` — это hero/marketplace packshot, а не полноценный b-roll source. Вчерашний smoke на TT04102/YYS0101 подтвердил: технически FAL job проходит и архивируется, но результат не даёт usable b-roll. Paid submit теперь проходит через `source_gate`; packshot source, `risk=high` или `quality < 0.60` блокируются до списания FAL.

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
- `source_gate.ok = true` для paid-кандидата;
- `experiment_plan.next_actions` показывает следующий шаг;
- `variants[]` есть и промпты сохраняют identity товара.

Если dry-run вернул `source_gate.ok = false`, не запускать `submit:true`. Нужно сначала собрать/выбрать derived view: hand pickup, detail, lifestyle, table/in-use angle.

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

Для технического smoke на packshot есть явный override `allow_packshot:true` / `allow_packshot=1`, но это не считается производственным b-roll прогоном.

## Feedback loop

Product Twin Studio пишет сигналы через `/api/factory/product-broll-feedback`:

- `winner` / `usable`: источник и движение можно повторять похожими экспериментами;
- `weak`: не мусор, но не масштабировать без смены ракурса или motion;
- `reject`: записать причину (`packshot_only`, `wrong_source`, `identity_drift`, `morphing`, `not_ad_ready`).

Сигнал сохраняется в `content_assets.analysis.product_broll_feedback` и best-effort дублируется в `cf_signals`. Следующий batch должен идти только после разметки предыдущих 1-2 результатов.

## Yandex Disk

Большие ассеты должны оставаться в Yandex Disk. Если `source_image` возвращается как `yandex-disk:/...`, route перед submit вызывает `rehostImageForFal`, поэтому FAL получает временный fetchable URL. UI и отчёты должны показывать `preview_url`, а не raw pseudo-url.

## Acceptance

- Dry-run выбирает Product Twin перед prepared/WB.
- Submit требует явный `submit: true`.
- Unsafe source возвращает `409 mode=blocked` до FAL submit.
- `FAL_KEY` или `FAL_BILLING_KEY` обязателен только для paid submit.
- Результаты после approve/archive уходят в Yandex Disk, а не раздувают Supabase Storage.
