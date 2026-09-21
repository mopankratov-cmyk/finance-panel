-- Новый движок CTR-тестов: раунды с порядком вариантов, шаги с фазами,
-- управление кампанией на время замера.
--
-- Термины (владелец, 21.09.2026): РАУНД — полный проход по всем вариантам,
-- ШАГ — показ одного варианта внутри раунда. Шаг по-прежнему лежит строкой
-- ctr_test_rounds — имя осталось от старой модели, где «раунд» был одним показом
-- одного варианта. Функцию transition_ctr_test это не меняет: она закрывает
-- шаг и открывает следующий, а фазы и порядок ведёт TypeScript.
--
-- Тесты, созданные до миграции, остаются на engine_version = 1 и идут прежним
-- путём. Новые CTR-тесты создаются с engine_version = 2.

alter table public.ctr_tests
  -- 1 — прежний движок (дневные агрегаты из базы, кампанию не трогает),
  -- 2 — шаги с фазами, живая статистика WB, кампания на паузе, пока статистика устаивается.
  add column if not exists engine_version integer not null default 1,
  -- Сколько раундов (проходов по всем вариантам) в тесте.
  add column if not exists rounds_total integer not null default 1,
  -- Потолок времени на набор показов одним шагом: не набрал цель — стоп с пометкой «timeout».
  add column if not exists max_step_min integer not null default 180,
  -- Сколько ждать устоявшейся статистики после паузы рекламы, минут. Вышло время — тест
  -- встаёт на паузу, шаг не засчитывается и повторится при возобновлении.
  add column if not exists settle_max_min integer not null default 90,
  -- Сколько опросов подряд с одинаковыми цифрами считаются «устоявшейся» статистикой.
  add column if not exists settle_stable_reads integer not null default 3,
  -- Порядок вариантов по раундам: [[id, id, id], [id, id, id], ...].
  add column if not exists variant_orders jsonb,
  -- Статус привязанной кампании WB на старте теста (9 — шла, 11 — на паузе): в него она возвращается.
  add column if not exists campaign_status_before integer,
  -- true, пока тест менял статус кампании и не вернул её. Крон повторяет возврат, пока метка стоит.
  add column if not exists campaign_restore_pending boolean not null default false,
  add column if not exists campaign_restore_error text;

comment on column public.ctr_tests.engine_version is
  '1 — прежний движок, 2 — шаги с фазами: живая статистика WB, кампания на паузе, пока цифры устаиваются.';
comment on column public.ctr_tests.rounds_total is
  'Число раундов — полных проходов по всем вариантам.';
comment on column public.ctr_tests.max_step_min is
  'Максимум минут на набор целевых показов одним шагом.';
comment on column public.ctr_tests.settle_max_min is
  'Максимум минут ожидания устоявшейся статистики после паузы рекламы.';
comment on column public.ctr_tests.settle_stable_reads is
  'Сколько опросов подряд с одинаковыми показами, кликами и расходом считаются устоявшейся статистикой.';
comment on column public.ctr_tests.variant_orders is
  'Порядок вариантов по раундам: массив массивов id вариантов.';
comment on column public.ctr_tests.campaign_status_before is
  'Статус привязанной кампании WB на старте теста: 9 — шла, 11 — на паузе.';
comment on column public.ctr_tests.campaign_restore_pending is
  'Тест менял статус кампании и ещё не вернул её. Пока true, крон повторяет возврат.';

alter table public.ctr_test_rounds
  -- Номер раунда (прохода), с единицы. null у строк старого движка.
  add column if not exists pass_no integer,
  -- Фаза шага: swap → starting → warmup → collecting → settling. null у строк старого движка.
  add column if not exists phase text check (phase in ('swap', 'starting', 'warmup', 'collecting', 'settling')),
  add column if not exists phase_at timestamptz,
  -- Журнал шага: замеры при старте, стопе и после стабилизации, опросы, сбои и повторы.
  add column if not exists detail jsonb not null default '{}'::jsonb;

comment on column public.ctr_test_rounds.pass_no is
  'Номер раунда (прохода по всем вариантам), с единицы.';
comment on column public.ctr_test_rounds.phase is
  'Фаза идущего шага: swap, starting, warmup, collecting, settling.';
comment on column public.ctr_test_rounds.detail is
  'Журнал шага нового движка: замеры на старте/стопе/после стабилизации, опросы, число повторов и последняя ошибка.';
