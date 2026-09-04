create table if not exists public.finance_loan_documents (
  id uuid primary key default gen_random_uuid(),
  loan_id text not null,
  company_id text,
  file_name text not null,
  object_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  document_kind text not null default 'contract'
    check (document_kind in ('contract', 'schedule', 'amendment', 'statement', 'other')),
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists finance_loan_documents_loan_created_idx
  on public.finance_loan_documents (loan_id, created_at desc);

alter table public.finance_loan_documents enable row level security;

comment on table public.finance_loan_documents is
  'Private registry of every source document uploaded for a credit or loan. File bytes are stored in the private finance-loan-documents bucket.';
