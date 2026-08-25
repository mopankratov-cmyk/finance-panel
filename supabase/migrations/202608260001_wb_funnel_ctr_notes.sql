-- Заметки к CTR за конкретный день конкретного артикула.
--
-- Работа в воронке идёт вокруг CTR: «почему в этот день просело», «здесь
-- сменили обложку», «тут кампания встала на модерации». Сегодня такие
-- объяснения живут в голове и в переписке, и через неделю никто не помнит,
-- что означал провал 18-го числа.
--
-- Ключ — (кабинет, артикул, день): заметка описывает клетку таблицы, а не
-- кампанию. Кампаний за днём может быть несколько, они меняются, а вопрос
-- «что было в этот день с этим товаром» остаётся тем же.
create table if not exists public.wb_funnel_ctr_notes (
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  nm_id      bigint not null,
  date       date not null,
  note       text not null,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (cabinet_id, nm_id, date)
);

-- Экран спрашивает заметки сразу за всё окно дат по всем артикулам: индекс
-- по кабинету и дню закрывает именно этот запрос.
create index if not exists wb_funnel_ctr_notes_window_idx
  on public.wb_funnel_ctr_notes (cabinet_id, date);

comment on table public.wb_funnel_ctr_notes is 'Заметки владельца к CTR за день: почему в этот день было так. Ключ — кабинет, артикул, дата.';
comment on column public.wb_funnel_ctr_notes.note is 'Текст заметки. Пустая строка не хранится — заметка удаляется целиком.';

alter table public.wb_funnel_ctr_notes enable row level security;
revoke all privileges on public.wb_funnel_ctr_notes from anon, authenticated;
grant all privileges on public.wb_funnel_ctr_notes to service_role;
