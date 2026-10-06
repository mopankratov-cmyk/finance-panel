-- Владелец подтвердил две пары переводов по 400 000 ₽ от 23.09.2026.
-- Обе стороны загружены, но банк не передал ИНН или счёт контрагента, поэтому
-- общий безопасный алгоритм намеренно не смог доказать связь. Фиксируем только
-- эти четыре известные строки и предварительно сверяем их неизменяемые поля.

do $$
declare
  pair record;
  outgoing public.bank_review_items%rowtype;
  incoming public.bank_review_items%rowtype;
  pair_marker text;
  ids_to_confirm uuid[];
begin
  for pair in
    select * from (values
      ('2a46ea38-73a8-42ef-b9b6-90a59b13282d'::uuid, '459e7bcb-4f74-4d94-b9b8-83bf4d87afba'::uuid),
      ('4a088f29-33a8-416c-a02e-284253c5e5cb'::uuid, '90724e9c-d76e-4374-bec4-eba32a3b8896'::uuid)
    ) confirmed(outgoing_id, incoming_id)
  loop
    perform 1
    from public.bank_review_items
    where id in (pair.outgoing_id, pair.incoming_id)
    order by id
    for update;

    select * into outgoing from public.bank_review_items where id = pair.outgoing_id;
    select * into incoming from public.bank_review_items where id = pair.incoming_id;

    if outgoing.id is null or incoming.id is null then
      raise exception 'Не найдены подтверждённые строки перевода 400 000 ₽';
    end if;
    if outgoing.status = 'rejected' or incoming.status = 'rejected' then
      raise exception 'Одна из подтверждённых строк перевода 400 000 ₽ отклонена';
    end if;
    if outgoing.date <> date '2026-09-23' or incoming.date <> date '2026-09-23'
       or round(outgoing.amount::numeric, 2) <> -400000.00
       or round(incoming.amount::numeric, 2) <> 400000.00
       or outgoing.bank_account_number <> '40802810900000016002'
       or incoming.bank_account_number <> '40817810140105565250' then
      raise exception 'Реквизиты подтверждённого перевода 400 000 ₽ изменились';
    end if;
    if (outgoing.matched_transfer_id is not null and outgoing.matched_transfer_id <> incoming.id)
       or (incoming.matched_transfer_id is not null and incoming.matched_transfer_id <> outgoing.id) then
      raise exception 'Одна из строк 400 000 ₽ уже связана с другой операцией';
    end if;

    update public.bank_review_items
    set matched_transfer_id = case when id = outgoing.id then incoming.id else outgoing.id end,
        category = case
          when id = outgoing.id then 'Выбытие — Перевод между счетами'
          else 'Поступление — Перевод между счетами'
        end,
        status = case
          when status = 'approved' then status
          when company_id is not null and account_id is not null then 'ready'
          else 'needs_info'
        end,
        updated_at = now()
    where id in (outgoing.id, incoming.id);

    select array_agg(r.id order by r.id) into ids_to_confirm
    from public.bank_review_items r
    where r.id in (outgoing.id, incoming.id)
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

    pair_marker := least(outgoing.id::text, incoming.id::text);
    update public.payments p
    set category = case
          when p.import_source = 'bank-review:' || outgoing.id::text then 'Выбытие — Перевод между счетами'
          else 'Поступление — Перевод между счетами'
        end,
        comment = case
          when position('[dds-bank-transfer:' || pair_marker || ']' in coalesce(p.comment, '')) = 0
            then btrim(concat_ws(' ', nullif(p.comment, ''), '[dds-bank-transfer:' || pair_marker || ']'))
          else p.comment
        end
    where p.import_source in (
      'bank-review:' || outgoing.id::text,
      'bank-review:' || incoming.id::text
    ) and p.status = 'done';
  end loop;
end $$;

select jsonb_build_object(
  'linkedRows', count(*) filter (where matched_transfer_id is not null),
  'linkedPairs', count(distinct least(id::text, matched_transfer_id::text))
    filter (where matched_transfer_id is not null)
) as confirmed_400k_transfers
from public.bank_review_items
where id in (
  '2a46ea38-73a8-42ef-b9b6-90a59b13282d'::uuid,
  '4a088f29-33a8-416c-a02e-284253c5e5cb'::uuid,
  '459e7bcb-4f74-4d94-b9b8-83bf4d87afba'::uuid,
  '90724e9c-d76e-4374-bec4-eba32a3b8896'::uuid
);

notify pgrst, 'reload schema';
