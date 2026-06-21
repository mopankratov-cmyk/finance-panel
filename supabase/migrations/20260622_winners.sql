-- P2.1 — Winners loop: дурабельная петля победителей.
-- Добавляет is_winner-флаг + learnings в content_assets чтобы завод учился на зашедших роликах.
-- Применять в Supabase SQL Editor (как предыдущие миграции).

alter table content_assets
  add column if not exists is_winner      boolean not null default false,
  add column if not exists winner_at      timestamptz,
  add column if not exists winner_learnings jsonb;       -- {hook,format,route,engine,otk_score,views,followers,note}

-- быстрый подбор примеров-победителей по нише при идеации
create index if not exists content_assets_winners_niche_idx
  on content_assets(niche, winner_at desc)
  where is_winner = true;
