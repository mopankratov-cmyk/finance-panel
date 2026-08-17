-- «В избранное» из воронки WB (см. app/api/sync/funnel/route.ts).
-- WB добавил addToWishList в v3 sales-funnel (осень 2025) — поле уже приходит
-- в истории воронки, но колонки под него не было, и факт терялся при записи.
--
-- Колонка NULLABLE без default: строки, записанные до миграции (и дни, за
-- которые WB поле не прислал), добавлений в избранное НЕ ЗНАЮТ. Ноль здесь
-- означал бы «никто не добавил», а это выдумка. Заполняется следующими
-- прогонами синка воронки; глубокая история (DETAIL_HISTORY_REPORT) это поле
-- не отдаёт, поэтому старые дни остаются NULL — метрика честно молчит.

alter table public.wb_funnel_daily add column if not exists add_to_wishlist integer;

comment on column public.wb_funnel_daily.add_to_wishlist is 'Добавления в избранное за день (addToWishList из v3 sales-funnel). NULL — строка записана до появления колонки или WB поле не прислал.';
