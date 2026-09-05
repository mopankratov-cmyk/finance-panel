-- Гейт автоматики: запрет касается ТОЛЬКО переключения раундов.
--
-- Прошлая версия (202609050001) запрещала человеку любое действие над тестом с
-- включённой автоматикой. Проверка на живом экране показала, во что это
-- вылилось: тест нельзя было ни запустить, ни остановить, ни отменить — на
-- «Запустить первый слот» приходило `live swap is on: this test is rotated by
-- the job, not by hand`. Автоматика забирала себе весь тест, хотя ей нужен
-- ровно один шаг.
--
-- Правильная граница: крон владеет ротацией (advance), человек — жизнью теста
-- (start, pause, finish, cancel, winner). Иначе включение автоматики лишает
-- владельца возможности остановить то, что она делает с витриной, — а это
-- ровно то, чего нельзя допускать в необратимой записи.

drop function if exists public.ctr_auto_gate(bigint, boolean);

create or replace function public.ctr_auto_gate(p_test_id bigint, p_auto boolean, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_live boolean;
begin
  select live_swap_enabled into v_live from public.ctr_tests where id = p_test_id;
  if v_live is null then raise exception 'test not found'; end if;

  -- Крон умеет ровно одно: переключать раунды у теста, где автоматика включена.
  if p_auto and p_action <> 'advance' then
    raise exception 'the rotation job may only advance rounds';
  end if;
  if p_auto and not v_live then
    raise exception 'auto advance requested while live swap is off';
  end if;

  -- Человек не переключает раунды у теста, которым правит крон: иначе двое
  -- переставляли бы фото навстречу друг другу и ни один раунд нельзя было бы
  -- сопоставить с его картинкой. Всё остальное — запуск, пауза, финал,
  -- отмена — за человеком всегда.
  if v_live and not p_auto and p_action = 'advance' then
    raise exception 'live swap is on: rounds are switched by the job, not by hand';
  end if;
end;
$fn$;

revoke all on function public.ctr_auto_gate(bigint, boolean, text) from public;
grant execute on function public.ctr_auto_gate(bigint, boolean, text) to service_role;
