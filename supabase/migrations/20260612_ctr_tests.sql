-- CTR-тесты: A/B обложек по SKU.
create table if not exists public.ctr_tests (
  id bigint generated always as identity primary key,
  nm_id bigint not null,
  article text,
  name text,
  status text not null default 'draft',   -- draft | running | done
  created_at timestamptz default now()
);

create table if not exists public.ctr_variants (
  id bigint generated always as identity primary key,
  test_id bigint not null references public.ctr_tests(id) on delete cascade,
  label text,                              -- A / B / C ...
  image_url text not null,
  source text,                             -- card | generated | upload
  prompt text,
  is_winner boolean default false,
  created_at timestamptz default now()
);
create index if not exists ctr_variants_test on public.ctr_variants (test_id);

alter table public.ctr_tests enable row level security;
alter table public.ctr_variants enable row level security;
create policy "all" on public.ctr_tests for all using (true) with check (true);
create policy "all" on public.ctr_variants for all using (true) with check (true);
