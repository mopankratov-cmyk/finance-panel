-- Ручные настройки юнит-экономики на кабинет: ставка налога и дополнительная
-- комиссия кабинета (см. lib/unit/cabinetSettings.ts).
--
-- Зачем отдельная таблица, а не wb_cabinet_commission_overhead: та наполняется
-- синком из финотчёта и перезаписывается каждые сутки. Ручной ввод там был бы
-- затёрт при первом же прогоне app/api/sync/commissions.
--
-- Налог у каждой компании свой (у одного владельца кабинеты на разных юрлицах и
-- режимах), а часть кабинетов работает через посредника со своей комиссией сверх
-- удержаний площадки. Ни то, ни другое из API маркетплейса не выводится — это
-- знание владельца, поэтому вводится руками.
--
-- Обе колонки NULLABLE без default: NULL означает «владелец не задавал», и код
-- падает на прежнее поведение (налог 7% из параметра запроса, комиссии только
-- площадки). Ноль в этих колонках — это осознанный ноль, а не «не знаем».
--
-- cabinet_id ссылается на wb_cabinets: там лежат кабинеты обоих маркетплейсов
-- (колонка marketplace), поэтому таблица покрывает и WB, и Ozon.

create table if not exists public.cabinet_unit_settings (
  cabinet_id uuid primary key references public.wb_cabinets(id) on delete cascade,
  tax_pct numeric,
  extra_commission_pct numeric,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.cabinet_unit_settings is 'Ручные настройки юнит-экономики кабинета: налог и дополнительная комиссия. Заполняет владелец через экран юнит-экономики.';
comment on column public.cabinet_unit_settings.tax_pct is 'Ставка налога кабинета, % от цены покупателя. NULL — не задана, используется значение по умолчанию.';
comment on column public.cabinet_unit_settings.extra_commission_pct is 'Дополнительная комиссия кабинета (посредник, агент), % от цены продавца. NULL — не задана, дополнительной комиссии нет.';
comment on column public.cabinet_unit_settings.updated_by is 'Кто изменил настройку в последний раз — для разбора расхождений в расчётах.';

alter table public.cabinet_unit_settings enable row level security;

-- Доступ только через сервисный ключ (как у остальных бизнес-таблиц после
-- 202607310002_close_public_business_data): анонимной роли здесь делать нечего.
-- Приложение ходит своей httpOnly-сессией через API, а не Supabase Auth.
revoke all privileges on public.cabinet_unit_settings from anon, authenticated;
grant all privileges on public.cabinet_unit_settings to service_role;
