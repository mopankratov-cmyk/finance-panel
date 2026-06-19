-- Добавить unique constraint на (niche, hook_text) в viral_hooks.
-- Нужен для upsert в corpus-tick / niche-playbook (onConflict: "niche,hook_text").
-- Применить после 20260620_viral_corpus.sql (если таблица уже существует и есть дубли — сначала почистить их).

-- Удалить дубли перед созданием индекса (оставить строку с наибольшим viability_score):
delete from viral_hooks a
using viral_hooks b
where a.id < b.id
  and a.niche is not distinct from b.niche
  and a.hook_text = b.hook_text;

-- Unique индекс (partial: только там где hook_text не null):
create unique index if not exists viral_hooks_niche_hook_text_idx
  on viral_hooks(coalesce(niche,''), hook_text);

-- Также добавить updated_at если его нет (нужен для upsert):
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='viral_hooks' and column_name='updated_at'
  ) then
    alter table viral_hooks add column updated_at timestamptz default now();
  end if;
end $$;
