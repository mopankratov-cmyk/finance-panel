-- Предметы, скрытые из сверки Честного Знака, и отказ от раздела целиком.
--
-- Зачем: WB перечисляет допустимые идентификаторы задания, и по ним панель уже
-- сама понимает, маркируется товар или нет. Но классифицирует WB не всё: часть
-- заданий приходит без метаданных вовсе, и тогда «кода нет» неотличимо от
-- «кода не бывает». У конкурента (optimawb.ru) это решено руками — кнопкой
-- «скрыть» в строке и галочкой «не торгую маркируемым»; берём тот же приём как
-- дополнение к автоматике, а не вместо неё.
--
-- Скрываем ПРЕДМЕТ (wb_cards.subject), а не артикул: продавец мыслит
-- категориями — «пеналы не маркируются», — и новый артикул той же категории
-- не должен возвращать ложную тревогу.
--
-- Пустой массив и false — осознанное «ничего не скрыто», а не «не спрашивали».
create table if not exists public.kiz_reconcile_settings (
  cabinet_id       uuid primary key references public.wb_cabinets(id) on delete cascade,
  hidden_subjects  text[] not null default '{}',
  -- Владелец совсем не торгует маркируемым товаром: раздел прячется целиком.
  not_applicable   boolean not null default false,
  updated_at       timestamptz not null default now(),
  updated_by       text
);

comment on table public.kiz_reconcile_settings is 'Настройки сверки КИЗ на кабинет: скрытые предметы и отказ от раздела. Заполняет владелец с экрана «Сверка оборота».';
comment on column public.kiz_reconcile_settings.hidden_subjects is 'Предметы WB (wb_cards.subject), которые не маркируются: их строки не попадают в сверку.';
comment on column public.kiz_reconcile_settings.not_applicable is 'true — кабинет не торгует маркируемым товаром, раздел скрыт целиком.';

alter table public.kiz_reconcile_settings enable row level security;
revoke all privileges on public.kiz_reconcile_settings from anon, authenticated;
grant all privileges on public.kiz_reconcile_settings to service_role;
