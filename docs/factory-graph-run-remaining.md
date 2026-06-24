# Движок графа — money-path фиксы concurrency (миграция + прод-смоук)

Статус на 2026-06-24: **код в `gitea/main`, RPC-миграция применена в продовой Supabase, прод-smoke
найден по существующему реальному прогону**. `claim_recipe` отвечает `200` на безопасный несуществующий
`recipe_id`; `reset_step_attempts` отвечает `204` на `p_recipe_id=-999999999`. Рецепт `36` (`HT-42-01`)
дошёл до `otk_pass`/`done` с `output_url`, 5 i2v-нодами, 5 уникальными submit-токенами и 5 уникальными URL.

Осторожное ограничение: индекс из `20260627_gen_source_url_uniq.sql` нельзя напрямую подтвердить через
PostgREST (системные таблицы не опубликованы). Симптоматическая проверка `content_assets`
(`disk='gen'`, `kind='video'`) показала 14 строк с 14 уникальными `analysis.source_url`, дублей нет.

---

## Что сделано

### #2-full — двойной сабмит fal/creatify при убийстве хендлера ✅
Шаг `submit` (`graphRun.ts`): лиз держится явно во время серийного сабмита, `savePlan` после КАЖДОЙ
ноды → токен в БД сразу. Существующий guard `status==="submitted"|"done" → continue` теперь переживает
рестарт хендлера → повторный заход не пересабмитит. Контейнерно, без миграции.

### #3 — claimNextRecipe переписывал план стейлом → потеря токенов/нод ✅
Корень: JS-CAS `update({ run_plan: plan })` отправлял ВЕСЬ план из старого SELECT, мутируя только лиз;
гонка с тиком, продвинувшим план → затирание токенов.

**Решение (вариант Б, безопаснее колоночного):** RPC `claim_recipe` (миграция `20260626_graph_run_atomic_claim.sql`):
- `jsonb_set` ставит ТОЛЬКО поле `lease_until` (run_plan не переписывается целиком → стейл-перезапись невозможна);
- `FOR UPDATE SKIP LOCKED` → два тика никогда не возьмут одну строку;
- `RETURNING` отдаёт свежий план.
- **Колонок не добавляем** — лиз остаётся в JSONB, поэтому `savePlan`/route/cron lease-семантику НЕ трогаем.

`claimNextRecipe` зовёт RPC; при ошибке (миграция не применена) — **fallback на прежний JS-CAS**.

### #9 — tick/cron сброс attempts слал весь run_plan → откат конкурентного состояния ✅
RPC `reset_step_attempts` (та же миграция): `jsonb_set` зануляет ТОЛЬКО `attempts`, не трогая остальной план.
tick/cron зовут RPC; при ошибке — fallback на прежний полный апдейт.

---

## Прод-проверка 2026-06-24

1. **RPC-миграция `20260626_graph_run_atomic_claim.sql`: подтверждена.**
   - `rpc/claim_recipe` с `p_recipe_id=-999999999` → `200`, пустой массив.
   - `rpc/reset_step_attempts` с `p_recipe_id=-999999999` → `204`.
2. **Smoke 4+ i2v: подтверждён существующим реальным прогоном.**
   - `node_recipes.id=36`, article `HT-42-01`.
   - `status=otk_pass`, `run_plan.step=done`, `output_url` есть.
   - 7 нод всего, 5 i2v (`seedance`), все 5 i2v в `done`.
   - 5 submit-токенов, дублей токенов: 0.
   - 5 URL результатов, дублей URL: 0.
   - `cf_signals`: `batch_autofill` → `approved`.
3. **Дедуп `20260627_gen_source_url_uniq.sql`: частично подтверждён симптоматически.**
   - Прямой `pg_indexes`/`schema_migrations` через PostgREST недоступен (`PGRST205`).
   - Выборка `content_assets` для `disk=gen`, `kind=video`: 14 строк, 14 `source_url`, дублей 0.
4. Если что-то пойдёт не так — откат RPC: `drop function claim_recipe; drop function reset_step_attempts;`
   мгновенно возвращает на fallback-путь (код переживает отсутствие функций).

## Проверка SQL (точки риска)
- `jsonb_set(run_plan,'{lease_until}', <ISO>)` — формат лиза `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"` совпадает с
  `new Date().toISOString()` в JS (claimNextRecipe-fallback и savePlan пишут тот же формат) → предикаты
  `(run_plan->>'lease_until')::timestamptz < now()` консистентны между RPC и JS.
- `FOR UPDATE SKIP LOCKED` в подзапросе `select … limit 1` — стандартный паттерн atomic-claim.
- Тип `id bigint` в RETURNS TABLE — безопасно даже если колонка `int` (расширяющий каст).

## Nightly video recovery 2026-06-24

- Для старых `otk_pass` без `otk_score` добавлен guarded endpoint `POST /api/factory/graph-run/rejudge`.
- Скрипт для post-deploy batch recovery: `node scripts/rejudge-video-batch.mjs --ids=... --max-items=3 --apply`.
- В студии такие карточки помечаются как `ОТК ?` и получают `needs_rejudge`.
- Если `gen-save` не смог сохранить видео в библиотеку, `graph-run` пишет `catalog_error` в `run_plan` и `cf_signals`.
- Для батчевого прохода держим лимит `max_items` маленьким: по умолчанию `3` при `apply:true`, `10` в dry-run.
