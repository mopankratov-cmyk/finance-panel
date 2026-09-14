-- Применяет владелец. Дополнительные операционные расходы ДДС и их явная
-- связь с существующей расходной строкой ОПиУ. Платежи и базовые статьи не меняются.
create table if not exists public.finance_expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  opiu_article_id text check (opiu_article_id is null or opiu_article_id in (
    'external_ads', 'barter', 'cashback', 'external_target_ads', 'fulfillment',
    'transport', 'bank_fees', 'training', 'personnel', 'recruitment',
    'admin_contractors', 'software', 'office', 'self_purchases', 'marketing_contractors'
  )),
  created_at timestamptz not null default now()
);
create unique index if not exists finance_expense_categories_name_unique
  on public.finance_expense_categories (replace(lower(name), 'ё', 'е'));
alter table public.finance_expense_categories enable row level security;
revoke all on public.finance_expense_categories from anon, authenticated;
grant all on public.finance_expense_categories to service_role;
comment on table public.finance_expense_categories is 'Дополнительные операционные статьи ДДС. NULL opiu_article_id = не включать в ОПиУ.';
