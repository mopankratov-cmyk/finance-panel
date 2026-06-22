# Движок графа — оставшиеся money-path фиксы (нужен прод-смоук перед мёржем)

Ветка `fix/graph-run-reliability` закрыла безопасный подкластер (параллель кадров ОТК, fail-fast,
синхронный старт, сигнал assetBind, порядок persistClips). Ниже — **рискованные** фиксы concurrency,
которые трогают денежный путь и НЕ верифицируются локально (fal/Claude недоступны из РФ-egress).
Их нужно применять отдельно, с прод-смоук-тестом одного реального прогона и ревью владельца.

Все ссылки на строки — по `lib/factory/graphRun.ts` на момент этой ветки.

---

## #2-full — двойной сабмит fal/creatify при убийстве хендлера в середине submit ✅ СДЕЛАНО

**Статус:** реализовано в ветке `fix/graph-run-atomic-claim` (шаг `submit` в `graphRun.ts`).
Решение **контейнерное, без миграции и без изменения claim/cron** — поэтому shippable автономно:
- Лиз держится ВО ВРЕМЯ submit явно (`plan.lease_until = now+LEASE_MS` перед циклом) → конкурентный claim
  заблокирован, поведение конкурентности идентично прежнему (раньше лиз тоже держался до конца submit).
- `savePlan` ПОСЛЕ каждой сабмитнутой ноды → токен fal/creatify в БД сразу. Существующий guard
  `if (n.status==="done"||n.status==="submitted") continue` теперь работает и через рестарт хендлера →
  повторный заход не пересабмитит = нет двойной оплаты.
- `renderCount` фиксируется вместе с токенами; лиз обнуляется в самом конце (chain → gen-poll).

**Тест (прод-смоук):** рецепт на 4+ i2v-нодах; убедиться, что повторный тик не плодит вторые fal-задачи.

---

## #3 — claimNextRecipe CAS пишет устаревший plan (потеря токенов/URL нод)

**Где:** `claimNextRecipe` (~строки 269–294). CAS-`update` отправляет `plan`, прочитанный в начале из
`row.run_plan` (снапшот SELECT), мутируя только `lease_until`. Предикат `.or(lease_until …)` проверяет
ТОЛЬКО лиз. Если между SELECT и UPDATE другой тик продвинул план (submit→gen-poll, записал токены) и снял
лиз — наш CAS пройдёт по лизу и **затрёт свежий план стейлом**.

**Что нужно (spec) — вариант А (версия в JSONB, без миграции):**
1. Добавить `rev?: number` в `RunPlan`.
2. `savePlan` инкрементит `plan.rev = (plan.rev||0)+1` НА КАЖДОЙ записи — **и это должны делать ВСЕ писатели
   `run_plan`**: `savePlan`, `claimNextRecipe`, прямой `update` в `graph-run/route.ts:38`,
   `graph-run/tick/route.ts` и `cron/route.ts` (см. #9). Если хоть один писатель не бампит rev — claim начнёт
   ложно фейлиться и рецепты зависнут (ХУЖЕ текущей редкой гонки). Поэтому вариант А требует аудита всех писателей.
3. В `claimNextRecipe`: запомнить `rev0 = plan.rev`; в CAS добавить предикат совпадения rev:
   `rev0==null ? .is("run_plan->>rev", null) : .eq("run_plan->>rev", String(rev0))`. Бампить rev при claim.

**Вариант Б (РЕКОМЕНДОВАН — структурно исключает класс багов; миграция → ручное одобрение владельца):**
лиз в отдельной колонке + атомарный claim через RPC с `FOR UPDATE SKIP LOCKED`. RPC **не переписывает
`run_plan`** (только колонку лиза) и ВОЗВРАЩАЕТ свежий план — стейл-перезапись структурно невозможна.

Готовая миграция (применить ПОСЛЕ ревью, отдельным шагом):

```sql
-- supabase/migrations/<ts>_graph_run_atomic_claim.sql
alter table node_recipes add column if not exists lease_until timestamptz;
-- зеркалим текущий лиз из JSONB в колонку (бэкафилл активных прогонов)
update node_recipes set lease_until = (run_plan->>'lease_until')::timestamptz
  where run_plan ? 'lease_until' and (run_plan->>'lease_until') is not null;

create or replace function claim_recipe(p_recipe_id bigint, p_lease_ms int)
returns table (id bigint, article text, niche text, mode text, run_plan jsonb)
language sql security definer as $$
  update node_recipes nr
     set lease_until = now() + (p_lease_ms || ' milliseconds')::interval, updated_at = now()
   where nr.id = (
     select r.id from node_recipes r
      where r.status = 'running'
        and (p_recipe_id is null or r.id = p_recipe_id)
        and (r.lease_until is null or r.lease_until < now())
        and coalesce(r.run_plan->>'step','') not in ('done','failed')
      order by r.updated_at asc
      limit 1
      for update skip locked      -- два воркера НИКОГДА не возьмут одну строку
   )
  returning nr.id, nr.article, nr.niche, nr.mode, nr.run_plan;  -- свежий план, БЕЗ перезаписи
$$;
```

Код (с **graceful-fallback**, чтобы мёрж до миграции ничего не ломал):
1. `claimNextRecipe`: сперва `db.rpc("claim_recipe", { p_recipe_id: recipeId ?? null, p_lease_ms: LEASE_MS })`.
   Если `error` (RPC ещё не задеплоен) → **fallback на текущий JS-CAS** без изменений. Успех RPC → вернуть строку.
2. `savePlan`: зеркалить лиз в колонку — `update({ run_plan: plan, lease_until: plan.lease_until ?? null, … })`.
   Тогда колонка всегда = JSONB-лиз, и ВСЕ существующие JSONB-проверки (resurrection/restart/cron) продолжают
   работать как advisory, а RPC-колонка — атомарный гейт. Прямой `update` в `graph-run/route.ts:38` и
   tick/cron (#9) тоже добавить `lease_until: …` в set (4 писателя — мини-аудит, см. #9).
3. Лиз-колонка освобождается там же, где сейчас `plan.lease_until=null` (шаг-энд savePlan) — через зеркалирование.

**Почему безопасно при поэтапном раскате:** без миграции `claim_recipe` нет → fallback = сегодняшнее поведение
(0 изменений). После миграции RPC = атомарный claim. Зеркалирование колонки делает JSONB-проверки советующими,
а не источником истины — рассинхрон не ломает (RPC всё равно атомарен).
**Тест:** два параллельных тика на одном рецепте (resurrection-GET каждые 4с + self-chain) — токены не теряются,
рецепт не захватывается дважды, chain не застревает.

---

## #9 — tick/cron безусловный update(run_plan) для сброса attempts затирает конкурентное состояние

**Где:** `graph-run/tick/route.ts` и `graph-run/cron/route.ts` — после успешного шага делают
`db.update({ run_plan: ctx.plan, … }).eq("id", id)` БЕЗ предиката лиза/версии, отправляя свой in-memory план.
Если к этому моменту следующий тик уже продвинул рецепт — этот «сброс attempts» откатит план на шаг назад.

**Что нужно (spec):**
- Сбрасывать `attempts` точечным апдейтом ТОЛЬКО поля счётчика (не отправляя весь `run_plan`), либо тем же
  версионным/лиз-CAS, что и claim (#3). Если перейти на вариант Б (#3), привести оба места к условному апдейту.

**Тест:** тот же сценарий двух тиков; план не откатывается на шаг назад после успешного шага.

---

## Порядок

1. **#2-full — ✅ уже сделано** в этой ветке (контейнерно, без миграции).
2. **#3 вариантом Б** (RPC + колонка lease) — применить миграцию (выше) + код с graceful-fallback. Фундамент:
   даёт атомарный claim и условные апдейты для #9.
3. **#9** поверх — зеркалить лиз-колонку в tick/cron + сбрасывать `attempts` без отправки всего `run_plan`.
4. **Прод-смоук:** один реальный прогон рецепта на 4+ i2v-нодах + наблюдение, что нет двойных fal-задач,
   зависаний в `running`, и ОТК докручивается; затем мёрж.

## Что в этой ветке (`fix/graph-run-atomic-claim`)

Только **#2-full** (безопасно, без миграции). #3/#9 — спека выше, применяет владелец отдельным шагом
(миграция + ревью + прод-смоук). Не вшиваю #3/#9 в код автономно: они all-or-nothing на лиз-координации,
непроверяемы локально, а ошибка = рецепты виснут в проде навсегда (хуже текущей редкой гонки).
