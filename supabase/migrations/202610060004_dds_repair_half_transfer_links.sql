-- Старые версии связывания могли записать matched_transfer_id только в одну
-- банковскую строку. Такая пара выпадала и из очереди несвязанных, и из
-- обработки связанных переводов. Восстанавливаем обратную ссылку лишь когда
-- сумма, даты, разные счета и реквизиты однозначно подтверждают пару.

with candidates as (
  select source.id source_id, target.id target_id,
    (select substring(reason from length('__counterparty_account:')+1)
     from jsonb_array_elements_text(coalesce(source.reasons,'[]'::jsonb)) reason
     where reason like '__counterparty_account:%' limit 1) source_counterparty_account,
    (select substring(reason from length('__counterparty_account:')+1)
     from jsonb_array_elements_text(coalesce(target.reasons,'[]'::jsonb)) reason
     where reason like '__counterparty_account:%' limit 1) target_counterparty_account,
    source.bank_account_number source_account,
    target.bank_account_number target_account,
    source.owner_inn source_owner_inn,
    target.owner_inn target_owner_inn,
    source.counterparty_inn source_counterparty_inn,
    target.counterparty_inn target_counterparty_inn,
    count(*) over(partition by target.id) target_candidates
  from public.bank_review_items source
  join public.bank_review_items target on target.id=source.matched_transfer_id
  where target.matched_transfer_id is null
    and source.status<>'rejected' and target.status<>'rejected'
    and round(source.amount::numeric,2)+round(target.amount::numeric,2)=0
    and abs(source.date-target.date)<=3
    and nullif(source.bank_account_number,'') is not null
    and nullif(target.bank_account_number,'') is not null
    and source.bank_account_number<>target.bank_account_number
), half_links as (
  select source_id,target_id
  from candidates
  where target_candidates=1
    and (nullif(source_counterparty_account,'') is null or source_counterparty_account=target_account)
    and (nullif(target_counterparty_account,'') is null or target_counterparty_account=source_account)
    and (
      source_counterparty_account=target_account
      or target_counterparty_account=source_account
      or (nullif(source_owner_inn,'') is not null and source_owner_inn=target_owner_inn)
      or (nullif(source_counterparty_inn,'') is not null and source_counterparty_inn=target_owner_inn)
      or (nullif(target_counterparty_inn,'') is not null and target_counterparty_inn=source_owner_inn)
    )
)
update public.bank_review_items target
set matched_transfer_id=half_links.source_id, updated_at=now()
from half_links
where target.id=half_links.target_id;

-- Приводим статьи обеих сторон к правилам ДДС и создаём недостающий обычный
-- факт. Межконтурные займы только связываем: их проведение остаётся через
-- мастер займа, как и для новых выписок.
do $$
declare
  pair record;
  ids_to_confirm uuid[];
  is_filippov_loan boolean;
begin
  for pair in
    select o.id outgoing_id, i.id incoming_id,
      lower(coalesce(oc.group_name,'')||' '||coalesce(oc.name,'')) outgoing_company,
      lower(coalesce(ic.name,'')) incoming_company
    from public.bank_review_items o
    join public.bank_review_items i on i.id=o.matched_transfer_id and i.matched_transfer_id=o.id
    join public.companies oc on oc.id::text=o.company_id
    join public.companies ic on ic.id::text=i.company_id
    where o.amount<0 and i.amount>0 and o.status<>'rejected' and i.status<>'rejected'
  loop
    is_filippov_loan := pair.outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
      and pair.incoming_company ~ '(филиппов|коровкин)';

    perform public.link_bank_review_transfer(
      pair.outgoing_id,
      pair.incoming_id,
      case when is_filippov_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when is_filippov_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );

    if not is_filippov_loan then
      select array_agg(r.id order by r.id) into ids_to_confirm
      from public.bank_review_items r
      where r.id in(pair.outgoing_id,pair.incoming_id)
        and r.status in('ready','needs_info')
        and r.company_id is not null and r.account_id is not null
        and nullif(r.category,'') is not null and r.manager_answer is null
        and exists(select 1 from public.accounts a where a.id::text=r.account_id)
        and exists(select 1 from public.companies c where c.id::text=r.company_id)
        and not exists(select 1 from public.payments p where p.import_source like 'bank-review:'||r.id::text||':%')
        and not exists(select 1 from public.finance_payment_chains ch where ch.id=r.id);
      if cardinality(ids_to_confirm)>0 then
        perform public.confirm_bank_review_items(ids_to_confirm);
      end if;
    end if;
  end loop;
end $$;

select public.link_unlinked_dds_transfers();
notify pgrst,'reload schema';
