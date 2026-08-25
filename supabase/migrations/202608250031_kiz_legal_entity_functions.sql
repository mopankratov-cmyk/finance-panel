-- Привязка кодов маркировки к юрлицу. ОДНА функция на файл.
--
-- Прошлый вариант этого файла содержал две функции сразу и не применился:
-- редактор Supabase разбирает скрипт по своим правилам и на второй
-- долларовой кавычке решает, что строка не закрыта. Сводка вынесена в
-- 202608250032.
--
-- ПРАВИЛА, в порядке убывания надёжности.
--
-- Первое — по товару. Код Честного Знака выпущен на конкретный товар, а у
-- товара в справочнике есть владелец. Это единственное правило, работающее
-- для агентской схемы: куртка NORVIA, проданная через кабинет Оптимы,
-- остаётся товаром своего ИП, а сам кабинет собственного юрлица не имеет.
--
-- Второе — по собственному кабинету, если товар неизвестен: в реестре есть
-- коды карточек, которых в справочнике уже нет. Агентская связь сюда не
-- годится: агент не владеет товаром, значит и кодом.
--
-- Товар СИЛЬНЕЕ кабинета, поэтому первое правило перекрывает привязку,
-- сделанную вторым, — но только пока код не отправлен. Отправленный код
-- уже вписан в документ вывода под конкретным ИНН, и менять ему владельца
-- задним числом значит разойтись с бумагой.
--
-- Что не разобралось, остаётся null и показывается на экране отдельно.
-- Приписать код наугад хуже, чем сказать, что владелец неизвестен.

create or replace function public.kiz_attach_legal_entity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_by_product integer := 0;
  v_by_cabinet integer := 0;
  v_moved      integer := 0;
  v_left       integer := 0;
begin
  with owner as (
    select nm_id,
           min(legal_entity_id::text)::uuid as legal_entity_id,
           count(distinct legal_entity_id) as owners
    from public.products
    where nm_id is not null and legal_entity_id is not null
    group by nm_id
  )
  update public.kiz_withdrawals w
     set legal_entity_id = owner.legal_entity_id,
         updated_at = now()
    from owner
   where w.legal_entity_id is null
     and w.nm_id = owner.nm_id
     and owner.owners = 1;
  get diagnostics v_by_product = row_count;

  with owner as (
    select cabinet_id,
           min(legal_entity_id::text)::uuid as legal_entity_id,
           count(*) as owners
    from public.legal_entity_cabinets
    where relation = 'own'
    group by cabinet_id
  )
  update public.kiz_withdrawals w
     set legal_entity_id = owner.legal_entity_id,
         updated_at = now()
    from owner
   where w.legal_entity_id is null
     and w.cabinet_id = owner.cabinet_id
     and owner.owners = 1;
  get diagnostics v_by_cabinet = row_count;

  with owner as (
    select nm_id,
           min(legal_entity_id::text)::uuid as legal_entity_id,
           count(distinct legal_entity_id) as owners
    from public.products
    where nm_id is not null and legal_entity_id is not null
    group by nm_id
  )
  update public.kiz_withdrawals w
     set legal_entity_id = owner.legal_entity_id,
         updated_at = now()
    from owner
   where w.nm_id = owner.nm_id
     and owner.owners = 1
     and w.legal_entity_id is not null
     and w.legal_entity_id <> owner.legal_entity_id
     and w.status in ('sold', 'fbw', 'unknown', 'returned');
  get diagnostics v_moved = row_count;

  select count(*) into v_left from public.kiz_withdrawals where legal_entity_id is null;

  return jsonb_build_object(
    'byProduct', v_by_product,
    'byCabinet', v_by_cabinet,
    'moved', v_moved,
    'left', v_left
  );
end;
$fn$;

revoke all on function public.kiz_attach_legal_entity() from public;
grant execute on function public.kiz_attach_legal_entity() to service_role;

-- Разовое заполнение прямо при применении. Без него между миграцией и первым
-- ночным прогоном экран показывал бы ноль кодов у всех юрлиц — и это выглядело
-- бы как «дел нет», а не как «ещё не разобрано».
select public.kiz_attach_legal_entity();

notify pgrst, 'reload schema';
