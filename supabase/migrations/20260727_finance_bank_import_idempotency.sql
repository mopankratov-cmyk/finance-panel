create table if not exists public.bank_review_items (
  id uuid primary key,
  batch_id uuid not null,
  document_hash text not null,
  source_file_name text not null,
  external_id text not null,
  date date not null,
  amount numeric not null,
  bank_account_number text not null default '',
  owner_inn text not null default '',
  company_id text,
  account_id text,
  counterparty text not null default '',
  counterparty_inn text not null default '',
  purpose text not null default '',
  category text,
  confidence numeric not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  status text not null check (status in ('ready', 'needs_info', 'waiting_manager', 'approved', 'rejected')),
  matched_transfer_id uuid references public.bank_review_items(id) on delete set null,
  manager_question text,
  manager_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_review_items add column if not exists document_hash text;
update public.bank_review_items
set document_hash = 'legacy:' || batch_id::text
where document_hash is null or document_hash = '';
alter table public.bank_review_items alter column document_hash set not null;

drop index if exists public.bank_review_items_source_unique;
create unique index if not exists bank_review_items_document_row_unique
  on public.bank_review_items(document_hash, external_id);
create index if not exists bank_review_items_status_date_idx
  on public.bank_review_items(status, date desc);

create table if not exists public.bank_account_mappings (
  bank_account_number text primary key,
  owner_inn text not null default '',
  company_id text not null,
  account_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.bank_review_items enable row level security;
alter table public.bank_account_mappings enable row level security;

alter table public.payments
  add column if not exists import_source text;

create unique index if not exists payments_import_source_unique
  on public.payments(import_source);
