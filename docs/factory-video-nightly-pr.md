# PR: fix(factory): nightly video recovery + diagnostics

## Что меняется
- `graph-run` больше не банкит `otk_pass` с пустым `otk_score` как “норму”.
- Добавлен guarded `rejudge` для старых ночных роликов, включая batch-режим по `recipe_ids`.
- `gen-save` теперь получает `recipe_id` и `otk_axes`, а `graph-run` пишет `catalog_error`, если сохранение в библиотеку не удалось.
- `fal` сабмит теперь возвращает детализированную причину ошибки, а не общий `null`.
- Студия показывает `ОТК ?`, `needs_rejudge`, `node_errors` и `catalog_error` для проблемных прогонов.
- Добавлен ops-safe helper `scripts/rejudge-video-batch.mjs` для post-deploy recovery.

## Почему
- Ночные прогоны оставляли 17 роликов в состоянии `otk_pass` без `otk_score`.
- Часть ошибок терялась в общем “FAL_KEY / баланс / 422 модель”, из-за чего было трудно понять, что именно сломалось.
- Raw Remotion URL и часть видео не попадали в `content_assets`, поэтому библиотека не отражала реальное состояние прогона.

## Как проверял
- `npx eslint lib/factory/falVideo.ts lib/factory/nodeEngine.ts lib/factory/graphRun.ts app/api/factory/gen-save/route.ts app/api/factory/graph-run/rejudge/route.ts app/api/factory/studio/route.ts`
- `npx tsc --noEmit --pretty false`
- `npm run dev`
- `POST /api/factory/graph-run/rejudge` с `apply:false` на `recipe_ids:[39,38,14]`
- `POST /api/factory/batch` с `dry_run:true`

## Post-deploy
1. Открыть PR и пройти AI-gate.
2. После деплоя прогнать:
```bash
BASE_URL=https://your-domain CRON_SECRET=... \
node scripts/rejudge-video-batch.mjs --ids=39,38,14 --max-items=3 --apply
```
3. Проверить в studio, что карточки с `ОТК ?` ушли в `otk_pass` / `warning`.
4. Проверить, что `content_assets` начал наполняться и `catalog_error` не растёт.

## Риски
- `video-critic` теперь деградирует в deterministic fallback при недоступном upstream; качество сигнала ниже, но выпуск не блокируется.
- `rejudge` intentionally ограничен батчем `max_items` для безопасного recovery.
