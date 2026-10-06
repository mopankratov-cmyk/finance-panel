-- Несколько одинаковых переводов между теми же счетами в один день дают
-- полную двудольную группу кандидатов. Прежний алгоритм считал каждую строку
-- неоднозначной и не связывал ни одну. Связываем закрытую группу только когда
-- число списаний равно числу поступлений и ни одна строка не подходит к
-- другому счету или дате.

do $$
declare
  pair record;
  outgoing_company text;
  incoming_company text;
  is_filippov_loan boolean;
  ids_to_confirm uuid[];
begin
  for pair in
    with eligible as (
      select r.*,
        (select substring(reason from length('__counterparty_account:') + 1)
         from jsonb_array_elements_text(coalesce(r.reasons, '[]'::jsonb)) reason
         where reason like '__counterparty_account:%' limit 1) counterparty_account
      from public.bank_review_items r
      where r.status in ('ready', 'needs_info', 'waiting_manager', 'approved')
        and r.matched_transfer_id is null
        and r.company_id is not null and r.account_id is not null
        and nullif(r.bank_account_number, '') is not null
    ), all_edges as (
      select o.id outgoing_id, i.id incoming_id,
        o.date outgoing_date, i.date incoming_date,
        round(abs(o.amount)::numeric, 2) payment_amount,
        o.bank_account_number outgoing_account,
        i.bank_account_number incoming_account
      from eligible o
      join eligible i on o.amount < 0 and i.amount > 0
        and abs(o.date - i.date) <= 3
        and round(i.amount::numeric, 2) = -round(o.amount::numeric, 2)
        and i.bank_account_number <> o.bank_account_number
        and (nullif(o.counterparty_account, '') is null or o.counterparty_account = i.bank_account_number)
        and (nullif(i.counterparty_account, '') is null or i.counterparty_account = o.bank_account_number)
        and (
          o.counterparty_account = i.bank_account_number
          or i.counterparty_account = o.bank_account_number
          or (nullif(o.owner_inn, '') is not null and o.owner_inn = i.owner_inn)
          or (nullif(o.counterparty_inn, '') is not null and o.counterparty_inn = i.owner_inn)
          or (nullif(i.counterparty_inn, '') is not null and i.counterparty_inn = o.owner_inn)
        )
    ), batch_edges as (
      select outgoing_id, incoming_id, outgoing_date payment_date, payment_amount,
        outgoing_account, incoming_account
      from all_edges
      where outgoing_date = incoming_date
    ), group_counts as (
      select payment_date, payment_amount, outgoing_account, incoming_account,
        count(distinct outgoing_id) outgoing_count,
        count(distinct incoming_id) incoming_count
      from batch_edges
      group by payment_date, payment_amount, outgoing_account, incoming_account
    ), outgoing_totals as (
      select outgoing_id, count(distinct incoming_id) candidate_count
      from all_edges group by outgoing_id
    ), incoming_totals as (
      select incoming_id, count(distinct outgoing_id) candidate_count
      from all_edges group by incoming_id
    ), safe_groups as (
      select g.*
      from group_counts g
      where g.outgoing_count = g.incoming_count and g.outgoing_count > 1
        and not exists (
          select 1 from batch_edges e join outgoing_totals t on t.outgoing_id = e.outgoing_id
          where e.payment_date = g.payment_date and e.payment_amount = g.payment_amount
            and e.outgoing_account = g.outgoing_account and e.incoming_account = g.incoming_account
            and t.candidate_count <> g.incoming_count
        )
        and not exists (
          select 1 from batch_edges e join incoming_totals t on t.incoming_id = e.incoming_id
          where e.payment_date = g.payment_date and e.payment_amount = g.payment_amount
            and e.outgoing_account = g.outgoing_account and e.incoming_account = g.incoming_account
            and t.candidate_count <> g.outgoing_count
        )
    ), batch_outgoing as (
      select distinct e.payment_date, e.payment_amount, e.outgoing_account, e.incoming_account, e.outgoing_id
      from batch_edges e join safe_groups g using(payment_date, payment_amount, outgoing_account, incoming_account)
    ), batch_incoming as (
      select distinct e.payment_date, e.payment_amount, e.outgoing_account, e.incoming_account, e.incoming_id
      from batch_edges e join safe_groups g using(payment_date, payment_amount, outgoing_account, incoming_account)
    ), outgoing_ranked as (
      select e.*,
        row_number() over (
          partition by e.payment_date, e.payment_amount, e.outgoing_account, e.incoming_account
          order by e.outgoing_id
        ) ordinal
      from batch_outgoing e
    ), incoming_ranked as (
      select e.*,
        row_number() over (
          partition by e.payment_date, e.payment_amount, e.outgoing_account, e.incoming_account
          order by e.incoming_id
        ) ordinal
      from batch_incoming e
    )
    select o.outgoing_id, i.incoming_id
    from outgoing_ranked o
    join incoming_ranked i using(payment_date, payment_amount, outgoing_account, incoming_account, ordinal)
    order by o.payment_date, o.payment_amount, o.outgoing_id
  loop
    select lower(coalesce(c.group_name, '') || ' ' || coalesce(c.name, ''))
      into outgoing_company
    from public.bank_review_items r join public.companies c on c.id::text = r.company_id
    where r.id = pair.outgoing_id;
    select lower(coalesce(c.name, '')) into incoming_company
    from public.bank_review_items r join public.companies c on c.id::text = r.company_id
    where r.id = pair.incoming_id;

    is_filippov_loan := outgoing_company ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
      and incoming_company ~ '(филиппов|коровкин)';
    perform public.link_bank_review_transfer(
      pair.outgoing_id,
      pair.incoming_id,
      case when is_filippov_loan then 'Выдача кредитов и займов' else 'Выбытие — Перевод между счетами' end,
      case when is_filippov_loan then 'Получение кредитов и займов' else 'Поступление — Перевод между счетами' end
    );

    if not is_filippov_loan then
      select array_agg(r.id order by r.id) into ids_to_confirm
      from public.bank_review_items r
      where r.id in (pair.outgoing_id, pair.incoming_id)
        and r.status in ('ready', 'needs_info')
        and r.company_id is not null and r.account_id is not null
        and nullif(r.category, '') is not null and r.manager_answer is null
        and exists (select 1 from public.accounts a where a.id::text = r.account_id)
        and exists (select 1 from public.companies c where c.id::text = r.company_id)
        and not exists (select 1 from public.payments p where p.import_source like 'bank-review:' || r.id::text || ':%')
        and not exists (select 1 from public.finance_payment_chains ch where ch.id = r.id);
      if cardinality(ids_to_confirm) > 0 then
        perform public.confirm_bank_review_items(ids_to_confirm);
      end if;
    end if;
  end loop;
end $$;

select public.link_unlinked_dds_transfers();
notify pgrst, 'reload schema';
