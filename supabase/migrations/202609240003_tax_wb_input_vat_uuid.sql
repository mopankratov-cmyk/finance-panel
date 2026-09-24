-- cabinet_id в wb_report_rows имеет тип uuid. Текстовое приведение из
-- предыдущей версии функции отключало индекс (cabinet_id, rr_dt) и приводило
-- к statement timeout на годовом объёме финансового отчёта.
drop function if exists public.tax_wb_input_vat(text[], date, date);

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
    and rr_dt <= p_to;
$$;

revoke all on function public.tax_wb_input_vat(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.tax_wb_input_vat(uuid[], date, date) to service_role;
