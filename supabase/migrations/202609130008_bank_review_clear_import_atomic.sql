-- Атомарная очистка импорта банковской выписки (аудит P2).
--
-- DELETE /api/opiu/bank-review сносит импорт двумя отдельными фазами — сначала
-- public.payments, потом public.bank_review_items, — и каждую пачками по 300
-- id: .in() на тысячи id иначе упирается в длину URL PostgREST (тот же приём,
-- что в kiz_claim_batch). Если сеть или база оборвётся между фазами или между
-- пачками одной фазы, чистка останавливается на середине: часть платежей уже
-- снесена, часть очереди — ещё нет. Повторное нажатие «Очистить импорт» после
-- такого обрыва либо не находит, что доудалять (тихо решив, что всё чисто),
-- либо расходится с тем, что видно на экране.
--
-- Функция ниже выполняет обе фазы одним вызовом. SQL-функция — это одна неявная
-- транзакция: либо обе таблицы очищены целиком, либо (при ошибке посередине)
-- не тронута ни одна строка. Список id идёт параметром массива, а не через
-- .in() с шагом по 300 — весь список едет в теле POST к rpc, а не в query
-- string, значит батчинг по длине URL здесь больше не нужен.
--
-- Порядок внутри функции (payments, затем bank_review_items) сохранён из
-- прежнего кода ради минимального отличия; на атомарность он не влияет — оба
-- delete либо применяются вместе, либо не применяется ни один.

create or replace function public.bank_review_clear_import(
  p_payment_ids uuid[],
  p_review_ids uuid[]
)
returns void
language sql
security definer
set search_path = public
as $fn$
  delete from public.payments where id = any(p_payment_ids);
  delete from public.bank_review_items where id = any(p_review_ids);
$fn$;

revoke all on function public.bank_review_clear_import(uuid[], uuid[]) from public;
grant execute on function public.bank_review_clear_import(uuid[], uuid[]) to service_role;

notify pgrst, 'reload schema';
