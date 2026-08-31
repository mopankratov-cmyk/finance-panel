-- Победитель CTR-теста: считать по тем, кто крутился, и мерить конверсию воронкой.
--
-- Правки по итогам ревью предыдущей миграции (202608310002):
--
--  * порог знаменателя брался как min() по ВСЕМ вариантам, включая те, до
--    которых очередь ни разу не дошла. Тест на четыре варианта, где два
--    открутились по 900 показов, а два стоят с нулём, закрыть было нельзя
--    никак: finish падал на «the weakest has 0», force не помогал (raise
--    случается раньше), автозакрытие по потолку тоже не срабатывало. Теперь
--    порог считается по участникам (rounds_count > 0), а неоткрученные
--    варианты не блокируют финал — про них пишется в объяснении победителя;
--
--  * «конверсия клик→заказ» делила заказы ВСЕЙ карточки (wb_funnel_daily) на
--    клики рекламы (wb_advert_nm_daily). Это не конверсия: величина зависит от
--    доли органики у варианта и на живых данных выходила больше 100%. Считаем
--    по одной воронке: заказы на открытие карточки — обе величины из одного
--    источника и сравнимы между вариантами.
--
-- Одна plpgsql-функция на файл: редактор Supabase молча не применяет файл, где
-- их несколько.

create or replace function public.transition_ctr_test(p_input jsonb, p_actor text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.ctr_tests%rowtype;
  v_round public.ctr_test_rounds%rowtype;
  v_winner public.ctr_variants%rowtype;
  v_baseline public.ctr_variants%rowtype;
  v_action text := coalesce(p_input->>'action', '');
  v_snapshot jsonb := coalesce(p_input->'snapshot', '{}'::jsonb);
  v_result jsonb := coalesce(p_input->'result', '{}'::jsonb);
  v_variant_id bigint := nullif(p_input->>'variantId', '')::bigint;
  v_total_spend numeric := 0;
  v_score numeric;
  v_explanation text;
  v_event_variant_id bigint;
  v_finish_now boolean := false;
  v_min_denominator bigint;
  v_participants integer := 0;
  v_idle integer := 0;
  v_short boolean := false;
  v_note text := '';
  v_winner_conv numeric;
  v_base_conv numeric;
begin
  select * into v_test from public.ctr_tests where id = (p_input->>'testId')::bigint for update;
  if not found or v_test.cabinet_id is null then raise exception 'test not found'; end if;
  if v_test.live_swap_enabled then raise exception 'live swap must remain disabled'; end if;

  if v_action = 'start' then
    if v_test.status not in ('draft', 'paused') then raise exception 'test cannot be started from current status'; end if;
    select coalesce(sum(spend), 0) into v_total_spend from public.ctr_variants where test_id = v_test.id;
    if v_total_spend >= v_test.spend_cap_rub then raise exception 'spend cap reached'; end if;
    if v_variant_id is null then
      select id into v_variant_id from public.ctr_variants where test_id = v_test.id order by position limit 1;
    end if;
    if not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
    v_event_variant_id := v_variant_id;
    insert into public.ctr_test_rounds(test_id, variant_id, round_number, baseline, actor)
    values (v_test.id, v_variant_id, v_test.round_num + 1, v_snapshot, p_actor);
    update public.ctr_tests set status = 'running', current_variant_id = v_variant_id,
      round_num = round_num + 1, started_at = coalesce(started_at, now()), updated_at = now()
    where id = v_test.id;

  elsif v_action in ('advance', 'pause', 'finish', 'cancel') then
    if v_test.status = 'running' then
      select * into v_round from public.ctr_test_rounds where test_id = v_test.id and status = 'active' for update;
      if not found then raise exception 'active round not found'; end if;
      v_event_variant_id := v_round.variant_id;
      update public.ctr_test_rounds set status = case when v_action = 'cancel' then 'cancelled' else 'closed' end,
        result = v_result, close_reason = v_action, ended_at = now()
      where id = v_round.id;
      update public.ctr_variants set
        impressions = impressions + coalesce((v_result->>'impressions')::bigint, 0),
        clicks = clicks + coalesce((v_result->>'clicks')::bigint, 0),
        spend = spend + coalesce((v_result->>'spend')::numeric, 0),
        opens = opens + coalesce((v_result->>'opens')::bigint, 0),
        carts = carts + coalesce((v_result->>'carts')::bigint, 0),
        orders = orders + coalesce((v_result->>'orders')::bigint, 0),
        rounds_count = rounds_count + 1,
        updated_at = now()
      where id = v_round.variant_id;

      -- Лидер раунда — только среди вариантов, добравших порог.
      select id into v_variant_id from public.ctr_variants
       where test_id = v_test.id
         and public.ctr_score(v_test.test_type, impressions, clicks, opens, carts, orders) is not null
       order by public.ctr_score(v_test.test_type, impressions, clicks, opens, carts, orders) desc,
                position asc
       limit 1;
      if v_variant_id is not null and v_action <> 'cancel' then
        update public.ctr_variants set rounds_won = rounds_won + 1, updated_at = now() where id = v_variant_id;
      end if;
    elsif v_action in ('advance', 'pause') then
      raise exception 'test is not running';
    end if;

    if v_action = 'advance' then
      select coalesce(sum(spend), 0) into v_total_spend from public.ctr_variants where test_id = v_test.id;
      if v_total_spend >= v_test.spend_cap_rub then
        -- Потолок выбран. Если данных уже хватает на ответ — отвечаем, а не
        -- встаём молча на паузу: тест, умерший без вывода, стоил тех же денег.
        select min(public.ctr_denominator(v_test.test_type, impressions, opens))
          into v_min_denominator
          from public.ctr_variants where test_id = v_test.id and rounds_count > 0;
        if coalesce(v_min_denominator, 0) >= greatest(1, v_test.target_impressions / 2) then
          v_finish_now := true;
          v_action := 'cap_finished';
        else
          update public.ctr_tests set status = 'paused', current_variant_id = null, updated_at = now() where id = v_test.id;
          v_action := 'cap_paused';
        end if;
      else
        v_variant_id := nullif(p_input->>'variantId', '')::bigint;
        if v_variant_id is null then
          select id into v_variant_id from public.ctr_variants
          where test_id = v_test.id and position > (select position from public.ctr_variants where id = v_test.current_variant_id)
          order by position limit 1;
          if v_variant_id is null then select id into v_variant_id from public.ctr_variants where test_id = v_test.id order by position limit 1; end if;
        end if;
        if not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
        v_event_variant_id := v_variant_id;
        insert into public.ctr_test_rounds(test_id, variant_id, round_number, baseline, actor)
        values (v_test.id, v_variant_id, v_test.round_num + 1, v_snapshot, p_actor);
        update public.ctr_tests set status = 'running', current_variant_id = v_variant_id,
          round_num = round_num + 1, updated_at = now() where id = v_test.id;
      end if;
    elsif v_action = 'pause' then
      update public.ctr_tests set status = 'paused', current_variant_id = null, updated_at = now() where id = v_test.id;
    elsif v_action = 'cancel' then
      update public.ctr_tests set status = 'cancelled', current_variant_id = null, finished_at = now(), updated_at = now() where id = v_test.id;
    elsif v_action = 'finish' then
      v_finish_now := true;
    end if;

  elsif v_action = 'winner' then
    if v_variant_id is null or not exists (select 1 from public.ctr_variants where id = v_variant_id and test_id = v_test.id) then raise exception 'variant not found'; end if;
    if v_test.status = 'running' then raise exception 'pause the test before choosing a winner'; end if;
    v_event_variant_id := v_variant_id;
    update public.ctr_variants set is_winner = id = v_variant_id, updated_at = now() where test_id = v_test.id;
    update public.ctr_tests set status = 'done', current_variant_id = null, winner_variant_id = v_variant_id,
      winner_explanation = left(coalesce(nullif(p_input->>'explanation', ''), 'Победитель выбран вручную владельцем.'), 2000),
      finished_at = now(), updated_at = now() where id = v_test.id;
  else
    raise exception 'unknown action';
  end if;

  -- Объявление победителя. Общее для ручного финала и для автозакрытия по
  -- потолку: правило одно, и обходить его через вторую дверь нельзя.
  if v_finish_now then
    if v_test.status in ('done', 'cancelled') then raise exception 'test is already closed'; end if;

    -- Считаем ТОЛЬКО по вариантам, которые хотя бы раз крутились. Вариант, до
    -- которого очередь не дошла, иначе делал тест незакрываемым навсегда:
    -- min() по нему всегда ноль, и не помогал даже force.
    select min(public.ctr_denominator(v_test.test_type, impressions, opens)), count(*)
      into v_min_denominator, v_participants
      from public.ctr_variants where test_id = v_test.id and rounds_count > 0;
    select count(*) into v_idle from public.ctr_variants where test_id = v_test.id and rounds_count = 0;

    if coalesce(v_participants, 0) = 0 then
      raise exception 'no variant has been shown yet: nothing to compare';
    end if;
    if coalesce(v_participants, 0) < 2 then
      raise exception 'only one variant has been shown: a test of one is not a comparison';
    end if;

    -- Пол знаменателя. Ниже него доля не измерение, а шум, и «победитель» с
    -- двумя показами — это решение, принятое по случайному числу.
    if coalesce(v_min_denominator, 0) < 50 then
      raise exception 'not enough data: every shown variant needs at least 50 impressions (or card opens), the weakest has %',
        coalesce(v_min_denominator, 0);
    end if;

    -- Сравнение честно только на одинаковом объёме показов. Норму добрали не
    -- все — закрыть можно, но осознанно: с force и с пометкой в объяснении.
    v_short := v_min_denominator < v_test.target_impressions or v_idle > 0;
    if v_short and v_action <> 'cap_finished' and not coalesce((p_input->>'force')::boolean, false) then
      raise exception 'unequal exposure: the weakest shown variant has % of % target impressions, and % variant(s) were never shown; pass force=true to close anyway',
        v_min_denominator, v_test.target_impressions, v_idle;
    end if;

    select * into v_winner from public.ctr_variants
     where test_id = v_test.id
       and public.ctr_score(v_test.test_type, impressions, clicks, opens, carts, orders) is not null
     order by public.ctr_score(v_test.test_type, impressions, clicks, opens, carts, orders) desc,
              rounds_won desc, position asc
     limit 1;
    if v_winner.id is null then raise exception 'no variant reached the minimum denominator'; end if;

    v_score := public.ctr_score(v_test.test_type, v_winner.impressions, v_winner.clicks,
                                v_winner.opens, v_winner.carts, v_winner.orders);

    if v_min_denominator < v_test.target_impressions then
      v_note := v_note || format(' Норма показов добрана не всеми вариантами: у слабейшего %s из %s.',
                                 v_min_denominator, v_test.target_impressions);
    end if;
    if v_idle > 0 then
      v_note := v_note || format(' Вариантов, ни разу не откручённых: %s — в сравнении они не участвовали.', v_idle);
    end if;

    -- Клик не равно покупка. Считаем по ОДНОЙ воронке: заказы на открытие
    -- карточки. Деление заказов карточки на клики рекламы конверсией не
    -- является — величина зависит от доли органики у варианта и на живых
    -- данных выходит больше 100%.
    if v_test.test_type = 'ctr' then
      select * into v_baseline from public.ctr_variants where test_id = v_test.id and is_baseline limit 1;
      if v_baseline.id is not null and v_baseline.id <> v_winner.id
         and v_winner.opens >= 50 and v_baseline.opens >= 50 then
        v_winner_conv := v_winner.orders::numeric / v_winner.opens;
        v_base_conv := v_baseline.orders::numeric / v_baseline.opens;
        if v_winner_conv < v_base_conv then
          v_note := v_note || format(
            ' ВНИМАНИЕ: клик не равно покупка — конверсия карточки в заказ у победителя %s%% против %s%% у текущего фото.',
            round(v_winner_conv * 100, 2), round(v_base_conv * 100, 2));
        end if;
      end if;
    end if;

    v_explanation := case v_test.test_type
      when 'ctr' then format('Лучший CTR %s%%: %s кликов из %s показов.', round(v_score, 2), v_winner.clicks, v_winner.impressions)
      when 'cr' then format('Лучшая конверсия в корзину %s%%: %s корзин из %s открытий карточки.', round(v_score, 2), v_winner.carts, v_winner.opens)
      else format('Победитель по proxy-конверсии в заказ %s%%: %s заказов из %s открытий; WB API не отдаёт просмотры видео по вариантам.', round(v_score, 2), v_winner.orders, v_winner.opens)
    end || v_note;

    update public.ctr_variants set is_winner = id = v_winner.id, updated_at = now() where test_id = v_test.id;
    update public.ctr_tests set status = 'done', current_variant_id = null, winner_variant_id = v_winner.id,
      winner_explanation = left(v_explanation, 2000), finished_at = now(), updated_at = now()
    where id = v_test.id;
    v_event_variant_id := coalesce(v_event_variant_id, v_winner.id);
  end if;

  insert into public.ctr_test_events(test_id, action, actor, details)
  values (v_test.id, v_action, p_actor, jsonb_build_object('variantId', v_event_variant_id, 'result', v_result));
  return (select to_jsonb(saved) from public.ctr_tests saved where saved.id = v_test.id);
end;
$$;

revoke all on function public.transition_ctr_test(jsonb, text) from public;
grant execute on function public.transition_ctr_test(jsonb, text) to service_role;
