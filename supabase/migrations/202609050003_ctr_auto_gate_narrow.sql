-- Гейт автоматики перестаёт забирать себе весь тест.
--
-- Прошлая версия (202609050001) отклоняла ЛЮБОЕ ручное действие над тестом с
-- включённой автоматикой. На живом экране это вылезло сразу: «Запустить первый
-- слот» отвечало `live swap is on: this test is rotated by the job, not by
-- hand`. Тест нельзя было ни запустить, ни остановить, ни отменить — владелец
-- терял возможность прервать то, что панель делает с витриной. В необратимой
-- записи это недопустимо.
--
-- Сигнатуру не меняем намеренно: уже применённая transition_ctr_test зовёт
-- гейт двумя аргументами и не знает про действие, а пересоздавать её целиком
-- ради одной строки — это 236 строк на вставку руками и лишний риск опечатки.
-- Поэтому здесь остаётся ровно то, что гейт МОЖЕТ проверить, не зная действия:
-- крон не лезет в тест, где автоматика выключена.
--
-- Вторая половина правила — «человек не переключает раунды у автоматического
-- теста» — теперь живёт в роуте (app/api/ctrtest/[id]/action). Это слабее, чем
-- запрет в базе, и я говорю об этом прямо: защита держится на том, что у
-- ручного пути ровно один вызывающий. Крон при этом по-прежнему остановлен
-- базой, а он и есть та сторона, которая пишет на витрину без человека.

create or replace function public.ctr_auto_gate(p_test_id bigint, p_auto boolean)
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
  if p_auto and not v_live then
    raise exception 'auto advance requested while live swap is off';
  end if;
end;
$fn$;

revoke all on function public.ctr_auto_gate(bigint, boolean) from public;
grant execute on function public.ctr_auto_gate(bigint, boolean) to service_role;
