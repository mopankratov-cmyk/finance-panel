-- Фаза D методологии CTR-тестов (ТЗ владельца 15.09.2026): ИИ-разбор фото по
-- итогам теста — вердикт по каждому варианту (почему CTR такой, какой есть)
-- и рекомендации по доработке. Результат перезаписывается целиком при каждом
-- повторном запуске — одна колонка, не журнал версий: старый разбор ценности
-- не несёт, как только появился новый.

alter table public.ctr_tests
  add column if not exists ai_analysis jsonb,
  add column if not exists ai_analysis_generated_at timestamptz;

comment on column public.ctr_tests.ai_analysis is
  'Структурированный вывод Claude vision: {variants:[{variantId,verdict}], recommendations:[...]}. NULL — разбор ещё не запускали.';
