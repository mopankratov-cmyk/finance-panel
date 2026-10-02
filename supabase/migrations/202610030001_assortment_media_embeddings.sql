-- «Разработка ассортимента», этап 2: похожие силуэты по фото.
--
-- Отпечаток (вектор CLIP, 512 чисел) считает сборщик на Mac mini — фото
-- никуда, кроме панели, не уходят. Здесь только хранение и очередь: первые
-- два фото каждой модели, у которых отпечатка ещё нет. Фото, которое не
-- прочиталось, записывается с ошибкой и из очереди уходит.
--
-- Сходство по фото — связь «похожая модель», а не доказательство одной
-- вещи или общего производителя (ТЗ §6).

create extension if not exists vector with schema extensions;

create table if not exists public.assortment_media_embeddings (
  media_id      uuid primary key references public.assortment_media(id) on delete cascade,
  reference_id  uuid not null references public.assortment_references(id) on delete cascade,
  model         text not null,
  embedding     extensions.vector(512),
  error         text,
  created_at    timestamptz not null default now(),
  check (embedding is not null or error is not null)
);

create index if not exists assortment_media_embeddings_reference_idx
  on public.assortment_media_embeddings (reference_id);

alter table public.assortment_media_embeddings enable row level security;
revoke all on public.assortment_media_embeddings from anon, authenticated;

create or replace view public.assortment_embedding_queue
with (security_invoker = true) as
select m.id as media_id, m.reference_id, m.storage_path
from public.assortment_media m
where m.position < 2
  and not exists (select 1 from public.assortment_media_embeddings e where e.media_id = m.id);

revoke all on public.assortment_embedding_queue from anon, authenticated;
