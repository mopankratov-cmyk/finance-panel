-- Годовой SUM по всем строкам отчёта WB может превышать короткий statement_timeout
-- API даже при индексе (cabinet_id, rr_dt): PostgreSQL всё равно читает строки
-- основной таблицы ради ppvz_vw_nds. Частичный covering-индекс содержит только
-- ненулевой входящий НДС и позволяет выполнить расчёт полностью по индексу.
-- SQL Editor выполняет файл в транзакции, поэтому CONCURRENTLY здесь применять
-- нельзя (PostgreSQL вернёт 25001). Обычный индекс совместим и с SQL Editor,
-- и с миграционным раннером; выполнять лучше вне окна синхронизации отчёта WB.
create index if not exists wb_report_rows_cabinet_rr_dt_input_vat_idx
  on public.wb_report_rows (cabinet_id, rr_dt) include (ppvz_vw_nds)
  where ppvz_vw_nds is not null and ppvz_vw_nds <> 0;

create or replace function public.tax_wb_input_vat(
  p_cabinet_ids uuid[],
  p_from date,
  p_to date
) returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(coalesce(sum(ppvz_vw_nds), 0), 0)
  from public.wb_report_rows
  where cabinet_id = any(p_cabinet_ids)
    and rr_dt >= p_from
    and rr_dt <= p_to
    and ppvz_vw_nds is not null
    and ppvz_vw_nds <> 0;
$$;

revoke all on function public.tax_wb_input_vat(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.tax_wb_input_vat(uuid[], date, date) to service_role;

-- Рекламные расходы нельзя брать из строк финансового отчёта: WB выдаёт их
-- отдельной «Историей затрат» (adv/v1/upd). Для налогов берём весь кабинет,
-- без разнесения по названиям кампаний/брендам, и только реальные списания с
-- баланса/счёта. Промо-бонусы и кэшбэк расходом продавца не являются.
create or replace function public.tax_wb_advert_expense(
  p_cabinet_ids uuid[],
  p_from date,
  p_to date
) returns numeric
language sql
stable
set search_path = public
as $$
  select greatest(coalesce(sum(amount), 0), 0)
  from public.wb_advert_spend_history
  where cabinet_id = any(p_cabinet_ids)
    and date >= p_from
    and date <= p_to
    and lower(coalesce(payment_type, '')) not like '%бонус%'
    and lower(coalesce(payment_type, '')) not like '%кэшбэк%'
    and lower(coalesce(payment_type, '')) not like '%кешбэк%';
$$;

revoke all on function public.tax_wb_advert_expense(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.tax_wb_advert_expense(uuid[], date, date) to service_role;

-- Начало полной рекламной истории по всем кабинетам компании. Берём самую
-- позднюю из первых дат: до неё хотя бы один кабинет ещё не покрыт данными.
create or replace function public.tax_wb_advert_coverage_start(
  p_cabinet_ids uuid[]
) returns date
language sql
stable
set search_path = public
as $$
  select case
    when count(*) = cardinality(p_cabinet_ids) then max(first_date)
    else null
  end
  from (
    select cabinet_id, min(date) as first_date
    from public.wb_advert_spend_history
    where cabinet_id = any(p_cabinet_ids)
    group by cabinet_id
  ) coverage;
$$;

revoke all on function public.tax_wb_advert_coverage_start(uuid[]) from public, anon, authenticated;
grant execute on function public.tax_wb_advert_coverage_start(uuid[]) to service_role;
