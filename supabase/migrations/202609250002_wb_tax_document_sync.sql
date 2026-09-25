-- Автоматический реестр УПД/счетов-фактур WB.
-- Сначала сохраняем каталог источников: не каждый документ из раздела WB
-- является входящим УПД и не каждый можно автоматически принять к вычету.

create table if not exists public.marketplace_tax_document_sources (
  id uuid primary key,
  cabinet_id uuid not null references public.wb_cabinets(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  marketplace text not null default 'wb' check (marketplace in ('wb')),
  external_id text not null,
  category_code text not null default '',
  category_title text not null default '',
  extension text not null default '',
  source_created_at timestamptz,
  status text not null default 'discovered'
    check (status in ('discovered', 'imported', 'skipped', 'needs_review', 'error')),
  document_date date,
  document_number text not null default '',
  gross_amount numeric check (gross_amount is null or gross_amount >= 0),
  vat_rate numeric check (vat_rate is null or vat_rate in (0, 5, 7, 10, 20, 22)),
  vat_amount numeric check (vat_amount is null or vat_amount >= 0),
  seller_inn text,
  buyer_inn text,
  tax_document_id uuid references public.marketplace_tax_documents(id) on delete set null,
  last_error text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (cabinet_id, external_id)
);

create index if not exists marketplace_tax_document_sources_status_idx
  on public.marketplace_tax_document_sources(status, source_created_at desc);
create index if not exists marketplace_tax_document_sources_company_idx
  on public.marketplace_tax_document_sources(company_id, document_date desc);

comment on table public.marketplace_tax_document_sources is
  'Каталог документов WB и результат безопасного разбора. imported означает: УПД внесён в налоговый регистр со статусом вычета pending; право на вычет подтверждает бухгалтер.';

alter table public.marketplace_tax_document_sources enable row level security;
revoke all on public.marketplace_tax_document_sources from anon, authenticated;
grant all on public.marketplace_tax_document_sources to service_role;
