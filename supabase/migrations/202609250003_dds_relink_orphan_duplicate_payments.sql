-- 202609250002 отклоняет старую строку перекрывающейся выписки. Если только
-- старая строка уже успела создать факт ДДС, факт нельзя отменять: это реальная
-- операция. Переносим его источник на каноническую строку с identity-маркером.

create temporary table dds_orphan_duplicate_links on commit drop as
select duplicate.id duplicate_id,
       substring(reason from length('__duplicate_of:') + 1)::uuid canonical_id
from public.bank_review_items duplicate
cross join lateral jsonb_array_elements_text(coalesce(duplicate.reasons,'[]'::jsonb)) reason
where reason like '__duplicate_of:%'
  and duplicate.status='rejected';

-- Не трогаем пару, если у канонической строки уже есть свой платёж или цепочка:
-- в таком случае платёж старой строки действительно является повтором.
delete from dds_orphan_duplicate_links link
where exists (
  select 1 from public.payments payment
  where payment.import_source like 'bank-review:'||link.canonical_id::text||'%'
)
or exists (
  select 1 from public.finance_payment_chains chain where chain.id=link.canonical_id
);

update public.payments payment
set import_source='bank-review:'||link.canonical_id::text
  ||substring(payment.import_source from length('bank-review:'||link.duplicate_id::text)+1)
from dds_orphan_duplicate_links link
where payment.import_source like 'bank-review:'||link.duplicate_id::text||'%';

-- Синхронизируем реквизиты канонической карточки с уже проведённым фактом.
-- Назначение банка сохраняем из выписки; переносим только учётные поля.
with facts as (
  select distinct on (link.canonical_id)
    link.canonical_id,payment.account_id,payment.company_id,payment.category,payment.counterparty
  from dds_orphan_duplicate_links link
  join public.payments payment
    on payment.import_source like 'bank-review:'||link.canonical_id::text||'%'
   and payment.status='done'
  order by link.canonical_id,payment.id
)
update public.bank_review_items canonical
set account_id=facts.account_id::text,
    company_id=facts.company_id::text,
    category=facts.category,
    counterparty=coalesce(nullif(facts.counterparty,''),canonical.counterparty),
    status='approved',
    updated_at=now()
from facts where canonical.id=facts.canonical_id;

-- Защита от тихо незавершённой миграции.
do $$
begin
 if exists (
  select 1
  from dds_orphan_duplicate_links link
  join public.payments payment
    on payment.import_source like 'bank-review:'||link.duplicate_id::text||'%'
   and payment.status='done'
 ) then
  raise exception 'Не удалось перепривязать фактические платежи старых строк выписки';
 end if;
end $$;

notify pgrst,'reload schema';
