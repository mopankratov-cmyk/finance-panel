-- Восстановление банковской проекции после перепривязки дублей и синхронизация
-- ролей новых ревизий цепочек. Применяется после 202609250003.

create or replace function public.sync_bank_chain_entry_allocation() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.finance_bank_allocations allocation
  set chain_id=new.chain_id,
      chain_revision=new.revision,
      allocation_id=new.allocation_id,
      role=case when new.role='legacy' then 'legacy' else new.role end,
      updated_at=now()
  where allocation.payment_id=new.payment_id;
  return new;
end $$;

drop trigger if exists sync_bank_chain_entry_allocation on public.finance_payment_chain_entries;
create trigger sync_bank_chain_entry_allocation
after insert or update of chain_id,revision,role,allocation_id
on public.finance_payment_chain_entries
for each row execute function public.sync_bank_chain_entry_allocation();

-- Старые цепочки создавались до триггера выше: у них роль могла остаться
-- временной `chain`, хотя finance_payment_chain_entries уже знает точную роль.
update public.finance_bank_allocations allocation
set chain_id=entry.chain_id,
    chain_revision=entry.revision,
    allocation_id=entry.allocation_id,
    role=case when entry.role='legacy' then 'legacy' else entry.role end,
    updated_at=now()
from public.finance_payment_chain_entries entry
where entry.payment_id=allocation.payment_id
  and row(allocation.chain_id,allocation.chain_revision,allocation.allocation_id,allocation.role)
      is distinct from row(entry.chain_id,entry.revision,entry.allocation_id,case when entry.role='legacy' then 'legacy' else entry.role end);

-- 202609250003 поменяла import_source у двух фактов уже после удаления старой
-- банковской операции. Повторное присваивание запускает штатный проекционный
-- триггер и безопасно восстанавливает отсутствующие allocations для любых
-- таких строк, не дублируя уже существующие.
update public.payments payment
set import_source=payment.import_source
where payment.status='done'
  and payment.import_source ~ '^(bank-review|dds-chain):[0-9a-f-]{36}(:|$)'
  and not exists (
    select 1 from public.finance_bank_allocations allocation
    where allocation.payment_id=payment.id
  );

-- Эти две пары имеют зеркальные расчётные счета, ИНН, суммы и даты, но были
-- подтверждены до запуска автоматического повторного сопоставления. Старые
-- связи указывали на отклонённые дубли; сначала снимаем именно такие ссылки,
-- не затрагивая связи между двумя действующими строками.
update public.bank_review_items active
set matched_transfer_id=null, updated_at=now()
where active.status<>'rejected'
  and exists (
    select 1 from public.bank_review_items duplicate
    where duplicate.id=active.matched_transfer_id and duplicate.status='rejected'
  );

update public.bank_review_items duplicate
set matched_transfer_id=null, updated_at=now()
where duplicate.status='rejected'
  and duplicate.matched_transfer_id is not null;

do $$
declare pair record;
begin
  for pair in
    select * from (values
      ('1c1ae4f4-baa8-4a04-bb69-0d4dbd4d0f39'::uuid,'26c6a3de-919b-4263-92dc-03ff398439f4'::uuid),
      ('530eb223-5d75-4682-9287-addbdb4bf30f'::uuid,'1f513991-2b3f-4608-98c7-5c07cef8ba2b'::uuid)
    ) values_pair(outgoing_id,incoming_id)
  loop
    if exists (
      select 1 from public.bank_review_items outgoing
      join public.bank_review_items incoming on incoming.id=pair.incoming_id
      where outgoing.id=pair.outgoing_id
        and outgoing.status<>'rejected' and incoming.status<>'rejected'
        and outgoing.matched_transfer_id is null and incoming.matched_transfer_id is null
    ) then
      perform public.link_bank_review_transfer(
        pair.outgoing_id,
        pair.incoming_id,
        'Выбытие — Перевод между счетами',
        'Поступление — Перевод между счетами'
      );
    end if;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from public.payments payment
    join public.finance_bank_transactions transaction
      on transaction.review_item_id=substring(payment.import_source from '^[^:]+:([0-9a-f-]{36})')::uuid
    where payment.status='done'
      and payment.import_source ~ '^(bank-review|dds-chain):[0-9a-f-]{36}(:|$)'
      and not exists (
        select 1 from public.finance_bank_allocations allocation
        where allocation.payment_id=payment.id
      )
  ) then
    raise exception 'После восстановления остались факты банка без канонического распределения';
  end if;
end $$;

revoke all on function public.sync_bank_chain_entry_allocation() from public;
notify pgrst,'reload schema';
