-- Похожие модели по фото: для каждой другой модели — наименьшее косинусное
-- расстояние между её отпечатками и отпечатками заданной. Одна функция на
-- файл (грабли редактора Supabase), язык sql — без plpgsql.
--
-- Вызывает только сервер панели (service_role); анониму и пользователю закрыто.

create or replace function public.assortment_similar_models(p_reference_id uuid, p_limit integer default 8)
returns table (reference_id uuid, distance double precision)
language sql
stable
set search_path = public, extensions
as $$
  select e.reference_id, min(e.embedding <=> mine.embedding) as distance
  from public.assortment_media_embeddings e
  join public.assortment_media_embeddings mine
    on mine.reference_id = p_reference_id and mine.embedding is not null
  where e.reference_id <> p_reference_id
    and e.embedding is not null
  group by e.reference_id
  order by distance
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.assortment_similar_models(uuid, integer) from public, anon, authenticated;
grant execute on function public.assortment_similar_models(uuid, integer) to service_role;
