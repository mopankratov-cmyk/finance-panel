-- Владелец 16.09.2026: помимо теста на чистом поиске (Фаза A), он всегда
-- тестировал и на единой ставке (ЕРК) — показы 50/50 в поиске и на полках,
-- средний CTR по обеим площадкам сразу, потому что полки сами по себе дают
-- более высокий CTR, чем поиск с ВЧ-ключом, и смешанное значение честнее.
--
-- `campaign_mode` определяет, какие кампании считаются подходящим кандидатом
-- при привязке (lib/ctrtest/campaignBinding.ts): 'search_only' — только
-- cpc_search/cpm_search (поведение Фазы A, по умолчанию, ничего не меняет
-- для существующих тестов); 'unified' — только блок 'erk' (bid_type=unified).
alter table public.ctr_tests
  add column if not exists campaign_mode text not null default 'search_only'
    check (campaign_mode in ('search_only', 'unified'));
