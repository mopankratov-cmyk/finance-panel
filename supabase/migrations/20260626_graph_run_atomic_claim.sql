-- Движок графа: атомарный claim рецепта + безопасный сброс счётчика ретраев.
-- ВАРИАНТ Б (без новых колонок): обе функции меняют ТОЛЬКО нужное поле run_plan через jsonb_set,
-- НЕ переписывая JSONB целиком → стейл-перезапись токенов/нод/шага структурно невозможна.
-- Код вызывает их через db.rpc(...) с graceful-fallback: до применения этой миграции работает старый
-- JS-путь (поведение не меняется), после — атомарный claim. Идемпотентно (CREATE OR REPLACE).

-- #3 — атомарный захват одного «running»-рецепта со свободным лизом.
-- FOR UPDATE SKIP LOCKED: два параллельных тика (resurrection-GET + self-chain) НИКОГДА не возьмут одну строку.
-- jsonb_set ставит lease_until в ISO-8601 UTC (как new Date().toISOString() в JS — формат совместим).
-- RETURNING отдаёт СВЕЖИЙ план (без перезаписи) → claimNextRecipe получает актуальные ноды/токены.
create or replace function claim_recipe(p_recipe_id bigint, p_lease_ms int)
returns table (id bigint, article text, niche text, mode text, run_plan jsonb)
language sql
as $$
  update node_recipes nr
     set run_plan = jsonb_set(
           nr.run_plan,
           '{lease_until}',
           to_jsonb(to_char((now() + (p_lease_ms || ' milliseconds')::interval) at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
           true),
         updated_at = now()
   where nr.id = (
     select r.id
       from node_recipes r
      where r.status = 'running'
        and (p_recipe_id is null or r.id = p_recipe_id)
        and ((r.run_plan->>'lease_until') is null or (r.run_plan->>'lease_until')::timestamptz < now())
        and coalesce(r.run_plan->>'step', '') not in ('done', 'failed')
      order by r.updated_at asc
      limit 1
      for update skip locked
   )
  returning nr.id, nr.article, nr.niche, nr.mode, nr.run_plan;
$$;

-- #9 — сброс счётчика подряд-фейлов шага БЕЗ перезаписи остального плана (только поле attempts).
-- Раньше tick/cron слали весь run_plan → откатывали конкурентный claim/продвижение плана.
create or replace function reset_step_attempts(p_recipe_id bigint)
returns void
language sql
as $$
  update node_recipes
     set run_plan = jsonb_set(coalesce(run_plan, '{}'::jsonb), '{attempts}', '0'::jsonb),
         updated_at = now()
   where id = p_recipe_id;
$$;
