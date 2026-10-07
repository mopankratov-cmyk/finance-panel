-- Очистить имена, которые были подставлены в строки без получателя.
-- Назначение банка остаётся источником истины; по одному только типу операции
-- нельзя назначать физлицо и переносить его на соседние платежи.

with cleared as (
  update public.bank_review_items r
  set counterparty = '', updated_at = now()
  where r.status in ('ready', 'needs_info', 'waiting_manager')
    and nullif(trim(r.counterparty), '') is not null
    and (
      lower(coalesce(r.purpose, '')) ~ '(выдача|снятие)[^.]*(наличн|банкомат)'
      or (
        lower(coalesce(r.purpose, '')) ~ 'перевод (сбп|на карту).*перевод в (t-bank|т-банк|тинькофф|сбербанк|альфа-банк|озон банк)'
        and lower(coalesce(r.purpose, '')) !~ '(получатель|перевод для|перевод от|в пользу)[[:space:]]+[[:alpha:]]'
      )
    )
  returning r.id
)
update public.payments p
set counterparty = ''
from cleared c
where p.import_source like 'bank-review:' || c.id::text || '%';

-- Если снятие наличных уже было проведено цепочкой, убираем то же выдуманное
-- ФИО из созданных частей. Компанию, статью и саму цепочку не меняем.
update public.payments p
set counterparty = ''
from public.finance_payment_chain_entries e
join public.bank_review_items r on r.id = e.chain_id
where e.payment_id = p.id
  and lower(coalesce(r.purpose, '')) ~ '(выдача|снятие)[^.]*(наличн|банкомат)';

-- В этой строке банк называет получателя Артёмом Ф., поэтому Новиков не может
-- оставаться контрагентом. Полное ФИО из сокращения не восстанавливаем.
update public.bank_review_items
set counterparty = '', updated_at = now()
where date = date '2026-09-22' and amount = -100000
  and lower(coalesce(purpose, '')) like '%получатель артем сергеевич ф.%'
  and lower(coalesce(counterparty, '')) like '%новиков%';

-- Пользователь подтвердил тип операции, но встречной стороны среди выгрузки
-- нет. Помечаем её переводом и оставляем выбор исходного кошелька человеку.
update public.bank_review_items
set category = 'Поступление — Перевод между счетами', status = 'needs_info', updated_at = now()
where id = 'c06be0bf-a611-4035-a530-0a5aa918232d'::uuid
  and date = date '2026-09-22' and amount = 2901;

-- В исходном банке для этого подтверждённого платежа указан Т-Банк. Старый
-- импорт сохранил только общий текст СБП, поэтому возвращаем банк назначения.
update public.bank_review_items
set purpose = trim(trailing '.' from purpose) || '. Перевод в Т-Банк.', updated_at = now()
where id = '14fa9846-1bd5-4707-924b-8ceba1bf0b09'::uuid
  and date = date '2026-10-01' and amount = -200000
  and lower(coalesce(purpose, '')) not like '%т-банк%';

-- Повторяем безопасное связывание после очистки: функция соединяет только
-- пары с одинаковой суммой и подтверждающими реквизитами счетов.
select public.link_unlinked_dds_transfers();

notify pgrst, 'reload schema';
