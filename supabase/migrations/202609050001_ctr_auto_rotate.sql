-- Автоматическая ротация вариантов CTR-теста.
--
-- До сих пор панель НИЧЕГО не меняла в карточке сама: человек ставил вариант
-- руками и подтверждал начало раунда словом CONTENT_IS_SET. Функция перехода
-- прямо запрещала автоматику — `if v_test.live_swap_enabled then raise`.
-- Решение владельца 05.09.2026: включить автоматическую смену.
--
-- Запрет не снят, а РАЗВЁРНУТ в обе стороны, и это важнее, чем кажется:
--   • тест с включённой автоматикой человек больше не двигает руками — иначе
--     двое (он и крон) переставляли бы фото навстречу друг другу, и ни один
--     раунд нельзя было бы сопоставить с его картинкой;
--   • крон не трогает тесты, где автоматика выключена.
-- То есть у каждого теста ровно один хозяин ротации, и он назван явно.

alter table public.ctr_tests
  -- Мёртвая зона после смены фото. После переключения ещё несколько минут
  -- приходят клики по ПРЕДЫДУЩЕЙ картинке: WB отдаёт выдачу из кеша, а человек
  -- уже видел старое фото. Без паузы эти клики приписываются новому варианту и
  -- завышают его CTR — тем сильнее, чем короче раунд.
  add column if not exists dead_zone_min integer not null default 10,
  -- Что стояло на карточке ДО теста, в полном размере и в исходном порядке.
  -- Каждое переключение отправляет [вариант, ...остальные из этого набора],
  -- поэтому галерея не растёт от раунда к раунду и не теряет кадры, а возврат
  -- к исходному — это просто ещё одно переключение.
  add column if not exists photos_original jsonb,
  -- Последняя попытка автоматики: когда смотрели и почему не переключили.
  -- Молчащая автоматика неотличима от сломанной.
  add column if not exists auto_checked_at timestamptz,
  add column if not exists auto_error text;

comment on column public.ctr_tests.dead_zone_min is
  'Минуты после смены фото, в которые ротация не считает показы: клики по прежней картинке искажают CTR новой.';
comment on column public.ctr_tests.photos_original is
  'Набор фото карточки до начала теста, в максимальном размере. Основа каждой записи в WB и возврата к исходному.';

-- Одна функция на файл — редактор Supabase иначе молча применяет только первую.
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
  if v_live and not p_auto then
    raise exception 'live swap is on: this test is rotated by the job, not by hand';
  end if;
  if p_auto and not v_live then
    raise exception 'auto advance requested while live swap is off';
  end if;
end;
$fn$;

revoke all on function public.ctr_auto_gate(bigint, boolean) from public;
grant execute on function public.ctr_auto_gate(bigint, boolean) to service_role;
