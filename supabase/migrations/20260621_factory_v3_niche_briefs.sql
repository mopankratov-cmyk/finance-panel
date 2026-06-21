-- V3 §14 Маркетолог-агент: кеш брифа ниши (резюме + форматы + рекомендации контента/дистрибуции + примеры).
-- Кешируется как niche_playbooks; corpus-cron может обновлять еженедельно. Идемпотентно.

create table if not exists niche_briefs (
  niche        text primary key,
  brief        jsonb not null,                 -- NicheBrief (§14): summary/top_formats/content_recommendations/distribution/viral_examples
  sources      jsonb,                          -- что агрегировано (счётчики корпуса/плейбука) — прозрачность
  updated_at   timestamptz not null default now()
);
