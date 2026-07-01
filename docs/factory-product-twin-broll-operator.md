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

## Quality loop v1

Автономная петля `/api/factory/product-broll-loop` делает четыре безопасных шага:

1. `action=plan` выбирает простой SKU (`cosmetics`/`toy`) и проверяет source gate.
2. `action=submit_one` отправляет ровно один paid FAL job, только если gate не заблокирован.
3. `action=judge&task_id=...` ждёт результат, архивирует видео в Yandex Disk, вытаскивает кадры и прогоняет artifact check.
4. `action=mark_reject` исправляет ложные positive-оценки и пишет feedback в Product Twin asset.

Автономный paid b-roll для `apparel` и `bag` заблокирован. Для одежды/сумок текущий генеративный i2v слишком легко дорисовывает несуществующие швы, фурнитуру, форму и логотипы. Их следующий путь — не “ещё больше FAL”, а real-photo motion montage из чистых кадров фотосессии: pan/zoom/crop/detail cuts без перерисовки товара.

## Real-photo montage lane

Для `apparel` и `bag` Product Twin Studio должен вести оператора в `/api/factory/product-broll-montage`, а не в generative submit:

1. `Plan Montage` выбирает только `derived_from_source` views из последнего twin.
2. Порядок кадров для одежды: `clean_front`/`on_model_front` → `closure_detail` → `fabric_macro`/`hood_detail` → `back`/`side`.
3. `Render Montage` собирает timeline только из реальных still-кадров товара, без synthetic_candidate image-to-video.
4. Готовый mp4 архивируется в Yandex Disk и каталогизируется в `content_assets.disk = gen`.

Если в latest twin нет real-photo views, оператор не должен рендерить montage. Сначала нужно пересобрать source-pack/derived views из чистой фотосессии.

NV-08 smoke от 2026-07-01 считается reject, даже если первый операторский клик поставил `usable`: пользователь увидел придуманные артефакты товара. Эту оценку нужно исправлять через `mark_reject` с причинами `identity_drift,artifact_detected,category_too_complex`.

## Yandex Disk

Большие ассеты должны оставаться в Yandex Disk. Если `source_image` возвращается как `yandex-disk:/...`, route перед submit вызывает `rehostImageForFal`, поэтому FAL получает временный fetchable URL. UI и отчёты должны показывать `preview_url`, а не raw pseudo-url.

## Acceptance

- Dry-run выбирает Product Twin перед prepared/WB.
- Submit требует явный `submit: true`.
- Unsafe source возвращает `409 mode=blocked` до FAL submit.
- Autonomous quality loop не тратит FAL на `apparel`/`bag` без ручного override.
- Каждый paid result проходит `judge` до следующего batch.
- `FAL_KEY` или `FAL_BILLING_KEY` обязателен только для paid submit.
- Результаты после approve/archive уходят в Yandex Disk, а не раздувают Supabase Storage.
