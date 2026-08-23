-- Защита от двойного проведения.
--
-- Регистр движений append-only: провёл — обратно не отыграешь, только сторно.
-- При этом три функции из четырёх генерировали идентификатор документа ВНУТРИ
-- себя, и второй клик по кнопке (или ретрай сети, или обновление вкладки на
-- медленном ответе) давал вторую отгрузку с новым идентификатором. Отличить её
-- от настоящей второй отгрузки задним числом невозможно.
--
-- Ключ выдаёт клиент — один на нажатие кнопки. Первый запрос занимает ключ,
-- второй упирается в первичный ключ и получает уже готовый ответ вместо новой
-- проводки. Это работает для ЛЮБОЙ функции проведения, не требуя переписывать
-- ни одну из них: слой идемпотентности живёт снаружи.

create table if not exists public.stock_doc_keys (
  key         text primary key,
  kind        text not null,
  legal_entity_id uuid references public.legal_entities(id) on delete cascade,
  -- Ответ первой попытки. Пока null — документ проводится прямо сейчас.
  result      jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);

comment on table public.stock_doc_keys is
  'Ключи идемпотентности проведения складских документов: один ключ на нажатие кнопки.';

create index if not exists stock_doc_keys_created_idx
  on public.stock_doc_keys (created_at desc);

revoke all on public.stock_doc_keys from anon, authenticated;

-- Зависший ключ (процесс умер между занятием и ответом) не должен запирать
-- операцию навсегда: через две минуты его разрешено перезанять.
create or replace function public.claim_stock_doc_key(
  p_key text,
  p_kind text,
  p_legal_entity_id uuid,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $claim_stock_doc_key$
declare
  v_row public.stock_doc_keys%rowtype;
begin
  select * into v_row from public.stock_doc_keys where key = p_key;
  if found then
    if v_row.result is not null then
      return jsonb_build_object('claimed', false, 'result', v_row.result);
    end if;
    if v_row.created_at > now() - interval '2 minutes' then
      return jsonb_build_object('claimed', false, 'result', null);
    end if;
    update public.stock_doc_keys
      set created_at = now(), created_by = coalesce(p_actor, created_by)
      where key = p_key;
    return jsonb_build_object('claimed', true, 'result', null);
  end if;

  insert into public.stock_doc_keys (key, kind, legal_entity_id, created_by)
  values (p_key, p_kind, p_legal_entity_id, p_actor);
  return jsonb_build_object('claimed', true, 'result', null);
exception
  when unique_violation then
    -- Гонка двух одинаковых нажатий: проиграл — значит документ уже проводится.
    return jsonb_build_object('claimed', false, 'result', null);
end;
$claim_stock_doc_key$;

create or replace function public.settle_stock_doc_key(p_key text, p_result jsonb)
returns void
language sql
security definer
set search_path = public
as $settle_stock_doc_key$
  update public.stock_doc_keys
    set result = p_result, settled_at = now()
    where key = p_key;
$settle_stock_doc_key$;

-- Проведение упало — ключ освобождаем, иначе повтор после исправления ошибки
-- будет вечно упираться в занятый ключ.
create or replace function public.release_stock_doc_key(p_key text)
returns void
language sql
security definer
set search_path = public
as $release_stock_doc_key$
  delete from public.stock_doc_keys where key = p_key and result is null;
$release_stock_doc_key$;

revoke all on function public.claim_stock_doc_key(text, text, uuid, text) from public;
grant execute on function public.claim_stock_doc_key(text, text, uuid, text) to service_role;
revoke all on function public.settle_stock_doc_key(text, jsonb) from public;
grant execute on function public.settle_stock_doc_key(text, jsonb) to service_role;
revoke all on function public.release_stock_doc_key(text) from public;
grant execute on function public.release_stock_doc_key(text) to service_role;

notify pgrst, 'reload schema';
