-- Годовой SUM по всем строкам отчёта WB может превышать короткий statement_timeout
-- API даже при индексе (cabinet_id, rr_dt): PostgreSQL всё равно читает строки
-- основной таблицы ради ppvz_vw_nds. Частичный covering-индекс содержит только
-- ненулевой входящий НДС и позволяет выполнить расчёт полностью по индексу.
-- CONCURRENTLY не блокирует загрузку новых отчётов WB на время построения индекса.
create index concurrently if not exists wb_report_rows_cabinet_rr_dt_input_vat_idx
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
