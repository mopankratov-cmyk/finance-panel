-- Цвет пометки на клетке CTR за день.
--
-- Заметка к клетке уже есть (202608260001), но текст читается только по
-- наведению: чтобы увидеть, где что происходило, приходится обходить таблицу
-- клетка за клеткой. Цвет виден сразу и всей сеткой — им размечают дни по
-- своему смыслу: «сменили обложку», «кампания на модерации», «проверяем гипотезу».
--
-- Смысл цвета задаёт сам продавец, поэтому в базе хранится только имя из
-- закрытого списка, а не готовый стиль: подписи и оттенки живут в
-- lib/wb/ctrNoteColors.ts и меняются без миграции. Закрытый список — чтобы в
-- колонку не попало произвольное значение из чужого запроса.
--
-- Пометка может быть только цветом, без единого слова: пустой текст с цветом —
-- это полноценная пометка, и строку с ней удалять нельзя. Поэтому note получает
-- значение по умолчанию — раньше пустая строка означала «заметки нет».

alter table public.wb_funnel_ctr_notes
  add column if not exists color text;

alter table public.wb_funnel_ctr_notes
  drop constraint if exists wb_funnel_ctr_notes_color_check;

alter table public.wb_funnel_ctr_notes
  add constraint wb_funnel_ctr_notes_color_check
  check (color is null or color in ('violet', 'sky', 'cyan', 'emerald', 'amber', 'orange', 'rose', 'slate'));

alter table public.wb_funnel_ctr_notes
  alter column note set default '';

comment on column public.wb_funnel_ctr_notes.color is
  'Имя цвета пометки из закрытого списка. NULL — пометка без цвета. Оттенки и подписи — в lib/wb/ctrNoteColors.ts.';
comment on column public.wb_funnel_ctr_notes.note is
  'Текст заметки. Пустая строка допустима: пометка может быть только цветом. Строка удаляется, когда нет ни текста, ни цвета.';

notify pgrst, 'reload schema';
