-- Номер документа выдаётся один раз и живёт в регистре вечно — ЧАСТЬ 1 из 2: схема.
--
-- В этом файле НЕТ ни одной функции: редактор Supabase спотыкается, когда
-- в одном скрипте лежат и DDL, и тело plpgsql. Процедуры — в 202608250029.
--
-- Повод. Сторно отмечает свои строки НОМЕРОМ исходного документа, и по нему же
-- проверяет, не отменён ли документ дважды. Регистр append-only: эта отметка
-- остаётся в базе навсегда. Значит номер, однажды выданный, нельзя выдать
-- второй раз — иначе новый документ унаследует чужую отметку и откажется
-- сторнироваться со словами «уже сторнирован», которых никто не поймёт.
--
-- Так и вышло на проверке: счётчик номеров однажды обнулили при уборке тестовых
-- данных, номер ОТГ-2026-0001 выдался заново, и отмена свежей накладной уперлась
-- в след от документа полугодовой давности.
--
-- Отсюда две меры. Первая — счётчик не ходит назад (в части 2). Вторая — здесь:
-- сторно перестаёт опираться на человеческую строку и запоминает саму проводку.

alter table public.stock_moves
  add column if not exists reverses_doc_id text;

comment on column public.stock_moves.reverses_doc_id is
  'Для строк сторно: идентификатор проводки, которую они отменяют. Точный ключ вместо человеческого номера.';

create index if not exists stock_moves_reverses_idx
  on public.stock_moves (reverses_doc_id)
  where reverses_doc_id is not null;

-- Прошлым строкам сторно проставляем ссылку, если её ещё можно восстановить:
-- документ сторно знает своё основание, а основание — свою проводку.
--
-- Сторож append-only снимаем на время: он бережёт количество и сумму, а здесь
-- заполняется ссылка, которой раньше не существовало. Остаток не меняется.
alter table public.stock_moves disable trigger stock_moves_append_only_trigger;

update public.stock_moves m
set reverses_doc_id = src.movement_doc_id
from public.stock_docs nd
join public.stock_docs src on src.id = nd.reverses
where m.doc_type = 'reversal'
  and m.doc_id = 'reversal:' || nd.id::text
  and m.reverses_doc_id is null
  and src.movement_doc_id is not null;

alter table public.stock_moves enable trigger stock_moves_append_only_trigger;

notify pgrst, 'reload schema';
