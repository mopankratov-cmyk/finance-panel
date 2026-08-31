-- Знаменатель и оценка варианта CTR-теста — в одном месте и для SQL, и для чтения.
--
-- Порог знаменателя жил только в TypeScript (lib/ctrtest/model.ts, CTR_MIN_VIEWS = 50)
-- и на решение не влиял ни разу: победителя в проде выбирает SQL-функция
-- transition_ctr_test, а chooseCtrWinner с порогом не вызывалась ниоткуда.
-- Из-за этого вариант с двумя показами и одним кликом объявлялся лучшим с
-- CTR 50%, и по такому «победителю» принимали решение всерьёз.

create or replace function public.ctr_denominator(p_type text, p_impressions bigint, p_opens bigint)
returns bigint
language sql
immutable
as $$
  select case
    when coalesce(p_type, 'ctr') = 'ctr' then coalesce(p_impressions, 0)
    else coalesce(p_opens, 0)
  end;
$$;

comment on function public.ctr_denominator(text, bigint, bigint) is
  'Знаменатель варианта: показы для теста ctr, открытия карточки для cr и video.';

create or replace function public.ctr_score(
  p_type text, p_impressions bigint, p_clicks bigint,
  p_opens bigint, p_carts bigint, p_orders bigint
)
returns numeric
language sql
immutable
as $$
  -- NULL — «мерить нечем», а не «ноль». Ниже пятидесяти доля не измерение, а
  -- шум: на десяти показах один клик даёт 10%, на двух — 50%.
  select case
    when public.ctr_denominator(p_type, p_impressions, p_opens) < 50 then null
    else (case coalesce(p_type, 'ctr')
            when 'ctr' then coalesce(p_clicks, 0)::numeric
            when 'cr' then coalesce(p_carts, 0)::numeric
            else coalesce(p_orders, 0)::numeric
          end) / public.ctr_denominator(p_type, p_impressions, p_opens) * 100
  end;
$$;

comment on function public.ctr_score(text, bigint, bigint, bigint, bigint, bigint) is
  'Доля варианта в процентах. NULL, если знаменателя меньше 50 — порог тот же, что CTR_MIN_VIEWS в lib/wb/ctrQuality.ts.';
