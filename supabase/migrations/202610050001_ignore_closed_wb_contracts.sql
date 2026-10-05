-- Закрытые договоры WB без документов не являются задолженностью панели.
-- Исходные строки отчёта сохраняются для аудита, но исключаются из очереди
-- ручной сверки и больше не требуют привязки к договору панели.

insert into public.loan_marketplace_ignored_contracts
  (marketplace, contract_number, reason, updated_at)
values
  ('wb', '2025060200617', 'Договор давно закрыт, документов и графика нет', now()),
  ('wb', '2025030400097', 'Договор давно закрыт, документов и графика нет', now())
on conflict (marketplace, contract_number) do update
set reason = excluded.reason,
    updated_at = excluded.updated_at;
