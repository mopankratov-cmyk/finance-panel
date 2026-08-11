-- Разбивка прочих удержаний WB по статьям (см. lib/wb/commissions.ts).
-- Финотчёт всегда отдавал deliveryService/paidStorage/penalty/paidAcceptance/deduction
-- по отдельности, но accumulateCommissionRows складывал их в один extra_pct, и РНП мог
-- показать только строку «логистика и прочие удержания» общей суммой. Эти колонки
-- сохраняют состав, чтобы разложить расходы МП по статьям.
--
-- Колонки NULLABLE намеренно, БЕЗ default 0: строки, записанные прежним синком, не знают
-- состава, и ноль в них означал бы «логистики не было». NULL читается кодом как
-- «источник состав не отдал» — метрика молчит вместо вранья. Заполнятся при следующем
-- прогоне app/api/sync/commissions, отдельного бэкфилла не требуется.
-- extra_pct остаётся источником истины по сумме и не пересчитывается из частей.

alter table public.wb_nm_commissions
  add column if not exists delivery_pct numeric,
  add column if not exists storage_pct numeric,
  add column if not exists penalty_pct numeric,
  add column if not exists acceptance_pct numeric,
  add column if not exists deduction_pct numeric;

comment on column public.wb_nm_commissions.delivery_pct is 'Логистика, % от выручки. NULL — синк ещё не отдавал состав удержаний.';
comment on column public.wb_nm_commissions.storage_pct is 'Платное хранение, % от выручки. NULL — состав неизвестен.';
comment on column public.wb_nm_commissions.penalty_pct is 'Штрафы, % от выручки. NULL — состав неизвестен.';
comment on column public.wb_nm_commissions.acceptance_pct is 'Платная приёмка, % от выручки. NULL — состав неизвестен.';
comment on column public.wb_nm_commissions.deduction_pct is 'Прочие удержания, % от выручки (реклама исключена — она вычитается отдельно). NULL — состав неизвестен.';
