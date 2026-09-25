-- В детализации WB отрицательное вознаграждение означает доплату/премию
-- продавцу (в том числе из-за скидки WB). Соответствующий отрицательный vwNds
-- не является входным НДС по приобретённой у WB услуге и не должен уменьшать
-- положительный контрольный НДС с комиссии WB. Фактический вычет по-прежнему
-- признаётся отдельно, только по полученному УПД/счёту-фактуре.
create or replace function public.tax_wb_input_vat(
  p_cabinet_ids uuid[],
  p_from date,
  p_to date
) returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(ppvz_vw_nds), 0)
  from public.wb_report_rows
  where cabinet_id = any(p_cabinet_ids)
    and rr_dt >= p_from
    and rr_dt <= p_to
    and ppvz_vw_nds > 0;
$$;

revoke all on function public.tax_wb_input_vat(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.tax_wb_input_vat(uuid[], date, date) to service_role;
