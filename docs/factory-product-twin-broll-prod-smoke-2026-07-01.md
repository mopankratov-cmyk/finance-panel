# Product Twin b-roll prod smoke

Дата: 2026-07-01.

## Что проверено

Endpoint:

`POST https://finance-panel-two.vercel.app/api/factory/product-broll-batch`

Payload dry-run:

```json
{
  "article": "NV-08",
  "count": 2,
  "recipe": "apparel_motion",
  "model": "kling",
  "submit": false
}
```

Результат без Bearer/session:

```json
{
  "status": 401,
  "error": "Не авторизовано"
}
```

## Вывод

Route на проде защищён. Автономный prod dry-run / paid smoke невозможен без непустого `CRON_SECRET` или браузерной сессии оператора.

Локальные env-файлы содержат имена production keys, но значения для `CRON_SECRET`, `FAL_KEY`, `FAL_BILLING_KEY`, `SUPABASE_SERVICE_ROLE_KEY` и `YANDEX_DISK_OAUTH_TOKEN` пустые. Поэтому платный mini-batch не запускался.

## Следующий операторский шаг

Когда доступ готов, выполнить dry-run из `docs/factory-product-twin-broll-operator.md` и проверить:

- `mode = dry_run`;
- `source_kind = product_twin_latest` или `product_twin_view`;
- `source_preview_url` заполнен;
- `twin_id` и `asset_id` заполнены.

Только после этого запускать paid smoke `count = 2`, `submit = true`.
