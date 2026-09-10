-- Журнал действий по ТЗ о правах (§17).
--
-- Существующая operation_audit_log для этого не годится: у неё cabinet_id
-- обязателен и ссылается на кабинет маркетплейса. А журналить надо и то, у
-- чего кабинета нет вовсе — вход в систему, заведение сотрудника, назначение
-- роли, изменение зарплаты. Прицепить их к произвольному кабинету значило бы
-- записать неправду в поле, по которому потом будут искать.
--
-- Поэтому отдельная таблица, и все три области — кабинет, юрлицо, склад —
-- необязательны: событие записывается с тем разрезом, который у него есть.
create table if not exists public.access_audit_log (
  id            bigint generated always as identity primary key,
  -- Кто. Учётка может быть удалена, а запись о её действиях обязана остаться,
  -- поэтому внешнего ключа нет намеренно: почта и роль хранятся копией.
  actor_id      uuid,
  actor_email   text,
  actor_roles   text[],
  -- Где. Ни одна из областей не обязательна: у входа в систему нет ни
  -- кабинета, ни склада, а у складской приёмки нет кабинета маркетплейса.
  organization_id uuid,
  entity_id     uuid,
  cabinet_id    uuid,
  warehouse_id  uuid,
  -- Что. `action` — машинная метка вида «user.role.assign», `subject` —
  -- над чем именно: артикул, номер платежа, почта сотрудника.
  action        text not null,
  subject       text,
  before_data   jsonb,
  after_data    jsonb,
  -- Откуда. ТЗ требует «IP-адрес или сведения о сессии».
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

comment on table public.access_audit_log is
  'Журнал действий по ТЗ о правах §17: входы, учётные записи и роли, зарплата, себестоимость, цены, рекламные бюджеты, поставки, финансовые отчёты и классификация, складские операции, выгрузки. Пользователь не может удалить историю собственных действий: писать разрешено только сервисной роли, удалять — никому.';

-- Три разреза, по которым журнал читают: кто, что и над чьими данными.
create index if not exists access_audit_log_actor_idx on public.access_audit_log (actor_id, created_at desc);
create index if not exists access_audit_log_action_idx on public.access_audit_log (action, created_at desc);
create index if not exists access_audit_log_entity_idx on public.access_audit_log (entity_id, created_at desc);
create index if not exists access_audit_log_created_idx on public.access_audit_log (created_at desc);

alter table public.access_audit_log enable row level security;
revoke all on table public.access_audit_log from anon, authenticated;
-- Пишет только сервер. Права на удаление и правку не выдаются ВООБЩЕ никому:
-- «пользователь не должен иметь возможность удалить историю собственных
-- действий» (§17), а самый надёжный способ это удержать — не раздавать право.
grant select, insert on table public.access_audit_log to service_role;

notify pgrst, 'reload schema';
