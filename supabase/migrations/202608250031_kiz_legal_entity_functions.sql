-- Реестр кодов подчиняется юрлицу — ЧАСТЬ 2 из 2: только процедуры.
--
-- В этом файле НЕТ ни одного create table и ни одного alter table.

-- ---------------------------------------------------------------------------
-- 1. Привязка кодов к юрлицу
-- ---------------------------------------------------------------------------
-- Два правила, в порядке убывания надёжности.
--
-- Первое — по товару. Код Честного Знака выпущен на конкретный товар, а у
-- товара в справочнике есть владелец. Это работает и для агентской схемы:
-- куртка NORVIA, проданная через кабинет Оптимы, остаётся товаром своего ИП.
--
-- Второе — по собственному кабинету. Если товар неизвестен (в реестре есть
-- коды старых карточек, которых в справочнике уже нет), но кабинет продажи
-- принадлежит ровно одному юрлицу как СОБСТВЕННЫЙ, берём его. Агентская связь
-- сюда не годится: агент не владеет товаром, а значит и кодом.
--
-- Что не разобралось — остаётся null. Приписать код наугад хуже, чем показать
-- его отдельной строкой «владелец не установлен»: по такому коду человек пойдёт
-- разбираться, а по приписанному не пойдёт.
--
-- Одна функция и для разового заполнения, и для ночного прогона: два разных
-- правила в двух местах разъехались бы молча.

create or replace function public.kiz_attach_legal_entity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $kiz_attach_legal_entity$
declare
  v_by_product integer := 0;
  v_by_cabinet integer := 0;
  v_left       integer := 0;
begin
  -- Правило 1: чей товар.
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

  -- Правило 2: чей собственный кабинет.
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

  select count(*) into v_left from public.kiz_withdrawals where legal_entity_id is null;

  return jsonb_build_object('byProduct', v_by_product, 'byCabinet', v_by_cabinet, 'left', v_left);
end;
$kiz_attach_legal_entity$;

revoke all on function public.kiz_attach_legal_entity() from public;
grant execute on function public.kiz_attach_legal_entity() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Сводка реестра одним запросом
-- ---------------------------------------------------------------------------
-- Раньше вкладка тянула ВЕСЬ реестр страницами по тысяче и считала статусы в
-- памяти процесса: одиннадцать тысяч строк — дюжина запросов на каждое открытие
-- экрана, и потолок, за которым это перестанет работать вовсе. Считать в базе
-- дешевле на порядок и не имеет потолка.
--
-- p_entity is null — весь реестр: это нужно ночному прогону для журнала и
-- владельцу, когда он смотрит «всё сразу».

create or replace function public.kiz_summary(p_entity uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $kiz_summary$
  with scope as (
    select status, price, sold_at
      from public.kiz_withdrawals
     where p_entity is null or legal_entity_id = p_entity
  ),
  pending as (select * from scope where status = 'sold')
  select jsonb_build_object(
    'pending',            (select count(*) from pending),
    'pendingAmount',      (select coalesce(sum(price), 0) from pending),
    'withoutPrice',       (select count(*) from pending where price is null),
    'sent',               (select count(*) from scope where status = 'sent'),
    'returned',           (select count(*) from scope where status = 'returned'),
    'returnedAfterSent',  (select count(*) from scope where status = 'returned_after_sent'),
    'fbw',                (select count(*) from scope where status = 'fbw'),
    'withdrawn',          (select count(*) from scope where status = 'withdrawn'),
    'unknown',            (select count(*) from scope where status = 'unknown'),
    'firstSoldAt',        (select min(sold_at)::text from scope where sold_at is not null),
    'lastSoldAt',         (select max(sold_at)::text from scope where sold_at is not null),
    -- Срок вывода — три рабочих дня. Считаем календарно с запасом: пять дней
    -- покрывают три рабочих с выходными, а завысить просрочку хуже, чем занизить.
    -- Код без даты продажи считаем свежим: возраст неизвестен, и обвинять
    -- систему в просрочке на пустом месте дороже, чем пропустить один код.
    'overdue',            (select count(*) from pending where sold_at is not null and sold_at < current_date - 5),
    'ageOverdue',         (select count(*) from pending where sold_at is not null and sold_at < current_date - 5),
    'ageLastDay',         (select count(*) from pending where sold_at is not null and sold_at >= current_date - 5 and sold_at < current_date - 4),
    'ageTwoDays',         (select count(*) from pending where sold_at is not null and sold_at >= current_date - 4 and sold_at < current_date - 2),
    'ageFresh',           (select count(*) from pending where sold_at is null or sold_at >= current_date - 2),
    'noEntity',           (select count(*) from public.kiz_withdrawals where legal_entity_id is null)
  );
$kiz_summary$;

revoke all on function public.kiz_summary(uuid) from public;
grant execute on function public.kiz_summary(uuid) to service_role;

notify pgrst, 'reload schema';
