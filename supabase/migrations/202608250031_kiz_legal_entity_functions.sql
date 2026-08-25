-- Привязка кодов маркировки к юрлицу. Чистый SQL, без plpgsql.
--
-- Прошлые два варианта этого файла не применились. Первый содержал две функции
-- сразу — редактор Supabase на второй долларовой кавычке решает, что строка не
-- закрыта. Второй был на plpgsql и не прошёл там, где соседние функции на
-- чистом SQL (kiz_summary, kiz_claim_batch) прошли без единой жалобы. Отсюда
-- правило: одна функция на файл, и по возможности language sql.
--
-- ПРАВИЛА, в порядке убывания надёжности.
--
-- Первое — по товару. Код Честного Знака выпущен на конкретный товар, а у
-- товара в справочнике есть владелец. Это единственное правило, работающее для
-- агентской схемы: куртка NORVIA, проданная через кабинет Оптимы, остаётся
-- товаром своего ИП, а сам кабинет собственного юрлица не имеет вовсе.
--
-- Второе — по собственному кабинету, если товар неизвестен: в реестре есть коды
-- карточек, которых в справочнике уже нет. Агентская связь сюда не годится:
-- агент не владеет товаром, значит и кодом.
--
-- Оба правила уместились в один оператор через coalesce: сначала товар, потом
-- кабинет. Так они не могут разъехаться и не зависят от порядка выполнения.
--
-- Третий оператор — исправление задним числом. Товар сильнее кабинета, поэтому
-- когда карточка появляется в справочнике позже, код переезжает к настоящему
-- владельцу. Но только пока не отправлен: отправленный код уже вписан в
-- документ вывода под конкретным ИНН, и менять ему владельца значит разойтись
-- с бумагой.
--
-- Что не разобралось, остаётся null и показывается на экране отдельной строкой.
-- Приписать код наугад хуже, чем сказать, что владелец неизвестен.

create or replace function public.kiz_attach_legal_entity()
returns jsonb
language sql
security definer
set search_path = public
as $fn$
  update public.kiz_withdrawals w
     set legal_entity_id = coalesce(
           (select min(p.legal_entity_id::text)::uuid
              from public.products p
             where p.nm_id = w.nm_id and p.legal_entity_id is not null
            having count(distinct p.legal_entity_id) = 1),
           (select min(l.legal_entity_id::text)::uuid
              from public.legal_entity_cabinets l
             where l.cabinet_id = w.cabinet_id and l.relation = 'own'
            having count(*) = 1)
         ),
         updated_at = now()
   where w.legal_entity_id is null
     and coalesce(
           (select min(p.legal_entity_id::text)::uuid
              from public.products p
             where p.nm_id = w.nm_id and p.legal_entity_id is not null
            having count(distinct p.legal_entity_id) = 1),
           (select min(l.legal_entity_id::text)::uuid
              from public.legal_entity_cabinets l
             where l.cabinet_id = w.cabinet_id and l.relation = 'own'
            having count(*) = 1)
         ) is not null;

  update public.kiz_withdrawals w
     set legal_entity_id = pe.legal_entity_id,
         updated_at = now()
    from (
      select nm_id, min(legal_entity_id::text)::uuid as legal_entity_id
        from public.products
       where nm_id is not null and legal_entity_id is not null
       group by nm_id
      having count(distinct legal_entity_id) = 1
    ) pe
   where w.nm_id = pe.nm_id
     and w.legal_entity_id is not null
     and w.legal_entity_id <> pe.legal_entity_id
     and w.status in ('sold', 'fbw', 'unknown', 'returned');

  select jsonb_build_object(
    'attached', (select count(*) from public.kiz_withdrawals where legal_entity_id is not null),
    'left', (select count(*) from public.kiz_withdrawals where legal_entity_id is null)
  );
$fn$;

revoke all on function public.kiz_attach_legal_entity() from public;
grant execute on function public.kiz_attach_legal_entity() to service_role;

notify pgrst, 'reload schema';
