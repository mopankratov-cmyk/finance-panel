-- Factory M6 foundation: personas/consent, UGC jobs, distribution/publications, richer metrics.
-- Idempotent and backwards-compatible:
-- - keeps existing brand_kits.persona_id text as provider/avatar override;
-- - keeps post_metrics.recipe_id for the current learning loop;
-- - adds nullable publication_id/external ids for the next distribution layer.

create extension if not exists pgcrypto;

-- ── Persona registry + consent gate ─────────────────────────────────────────
create table if not exists factory_personas (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  provider              text, -- creatify | heygen | argil | stock | human | other
  provider_persona_id   text,
  avatar_url            text,
  consent_status        text not null default 'unknown'
    check (consent_status in ('unknown','consented','revoked','stock','not_required')),
  consent_source        text, -- contract | platform_stock | owner | manual | imported
  consent_artifact_url  text,
  consent_checked_at    timestamptz,
  locale                text not null default 'ru-RU',
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (provider, provider_persona_id)
);
create index if not exists factory_personas_consent_idx on factory_personas(consent_status, provider);
create index if not exists factory_personas_provider_idx on factory_personas(provider, provider_persona_id);

alter table brand_kits
  add column if not exists persona_ref_id uuid references factory_personas(id) on delete set null,
  add column if not exists persona_consent_required boolean not null default true;
create index if not exists brand_kits_persona_ref_idx on brand_kits(persona_ref_id);

-- ── UGC render jobs: idempotency, retry and DLQ categories ───────────────────
create table if not exists factory_ugc_jobs (
  id                 uuid primary key default gen_random_uuid(),
  recipe_id          bigint references node_recipes(id) on delete set null,
  node_id            bigint references node_recipe_nodes(id) on delete set null,
  persona_id         uuid references factory_personas(id) on delete restrict,
  provider           text not null default 'creatify',
  provider_job_id    text,
  idempotency_key    text not null,
  status             text not null default 'queued'
    check (status in ('queued','submitted','rendering','qa','done','failed','dlq','cancelled')),
  dlq_category       text
    check (dlq_category is null or dlq_category in ('consent','policy','lipsync','face_drift','provider','timeout','budget','artifact','unknown')),
  input_payload      jsonb not null default '{}',
  qa_result          jsonb,
  output_url         text,
  error              text,
  attempts           int not null default 0,
  max_attempts       int not null default 2,
  lease_until        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (idempotency_key)
);
create index if not exists factory_ugc_jobs_recipe_idx on factory_ugc_jobs(recipe_id, created_at desc);
create index if not exists factory_ugc_jobs_status_idx on factory_ugc_jobs(status, lease_until, created_at);
create index if not exists factory_ugc_jobs_provider_idx on factory_ugc_jobs(provider, provider_job_id);

-- ── Distribution targets and publication rows ───────────────────────────────
create table if not exists factory_distribution_targets (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  platform            text not null, -- telegram | vk | tiktok | instagram | youtube | pinterest | manual
  account_ref         text,
  mode                text not null default 'organic'
    check (mode in ('organic','paid','manual')),
  ad_token_required   boolean not null default false,
  enabled             boolean not null default true,
  config              jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (platform, account_ref, mode)
);
create index if not exists factory_distribution_targets_enabled_idx on factory_distribution_targets(enabled, platform, mode);

create table if not exists factory_publications (
  id                    uuid primary key default gen_random_uuid(),
  recipe_id             bigint references node_recipes(id) on delete set null,
  ugc_job_id            uuid references factory_ugc_jobs(id) on delete set null,
  target_id             uuid references factory_distribution_targets(id) on delete set null,
  platform              text not null,
  mode                  text not null default 'organic'
    check (mode in ('organic','paid','manual')),
  status                text not null default 'draft'
    check (status in ('draft','scheduled','publishing','published','failed','cancelled')),
  source_url            text,
  published_url         text,
  external_post_id      text,
  ad_token_present      boolean not null default false,
  scheduled_at          timestamptz,
  published_at          timestamptz,
  last_metrics_pull_at  timestamptz,
  next_metrics_pull_at  timestamptz,
  error                 text,
  metadata              jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists factory_publications_recipe_idx on factory_publications(recipe_id, created_at desc);
create index if not exists factory_publications_status_idx on factory_publications(status, next_metrics_pull_at);
create index if not exists factory_publications_external_idx on factory_publications(platform, external_post_id);

-- Paid publication safety: paid rows must explicitly carry an ad token marker.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'factory_publications_paid_token_chk'
  ) then
    alter table factory_publications
      add constraint factory_publications_paid_token_chk
      check (mode <> 'paid' or ad_token_present = true);
  end if;
end $$;

alter table node_recipes
  add column if not exists latest_publication_id uuid,
  add column if not exists published_url text,
  add column if not exists distribution_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'node_recipes_latest_publication_fk'
  ) then
    alter table node_recipes
      add constraint node_recipes_latest_publication_fk
      foreign key (latest_publication_id) references factory_publications(id) on delete set null;
  end if;
end $$;
create index if not exists node_recipes_latest_publication_idx on node_recipes(latest_publication_id);

alter table cf_signals
  add column if not exists publication_id uuid references factory_publications(id) on delete set null;
create index if not exists cf_signals_publication_idx on cf_signals(publication_id);

-- ── Metrics extension: keep recipe_id, add publication/external dimensions ──
alter table post_metrics
  add column if not exists publication_id uuid references factory_publications(id) on delete set null,
  add column if not exists external_post_id text,
  add column if not exists hook_rate numeric,
  add column if not exists hold_rate numeric,
  add column if not exists completion_rate numeric,
  add column if not exists engagement_count bigint,
  add column if not exists marketplace_orders bigint,
  add column if not exists revenue numeric,
  add column if not exists pulled_at timestamptz,
  add column if not exists source text,
  add column if not exists raw_metrics jsonb not null default '{}';

create index if not exists post_metrics_publication_idx on post_metrics(publication_id, posted_at desc);
create index if not exists post_metrics_external_idx on post_metrics(platform, external_post_id);
create index if not exists post_metrics_pulled_idx on post_metrics(pulled_at desc);

notify pgrst, 'reload schema';
