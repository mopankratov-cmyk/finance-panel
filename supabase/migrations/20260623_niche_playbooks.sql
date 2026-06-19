-- Кеш скомпилированных плейбуков ниш (niche-playbook → LLM → кеш в БД).
-- Цель: фоновая очередь (jobs/tick scenario-шаг) получает production-playbook без LLM-вызова
-- и без браузерного localStorage. Обновляется при каждом запуске niche-playbook (upsert by niche).

create table if not exists niche_playbooks (
  niche           text primary key,                     -- clothing | toys | cosmetics | default
  article         text,                                  -- артикул, породивший этот плейбук
  orbit_job_id    text,                                  -- job_id Orbit-поиска (ссылка на orbit_searches)
  playbook        jsonb not null,                        -- полный JSON от niche-playbook (winning_formats, hooks, etc.)
  orbit_at        timestamptz,                           -- когда был финализирован Orbit
  updated_at      timestamptz not null default now()
);
create index if not exists niche_playbooks_updated_idx on niche_playbooks(updated_at desc);
