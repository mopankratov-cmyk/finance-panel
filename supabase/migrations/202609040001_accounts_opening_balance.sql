-- Остаток счёта на дату открытия. Дальше текущий остаток считается по
-- фактическим платежам (lib/finance/balance.ts), а не хранится руками:
-- колонка balance до этого не двигалась ни одним платежом, а прогноз
-- кассового разрыва строился так, будто двигалась.
alter table public.accounts
  add column if not exists opening_balance numeric not null default 0,
  add column if not exists opening_date date not null default current_date;

-- Один раз: то, что лежало в balance, становится остатком на сегодня.
update public.accounts
set opening_balance = coalesce(balance, 0),
    opening_date = current_date
where opening_balance = 0 and opening_date = current_date;

-- balance больше не пишется из интерфейса; default нужен для новых вставок.
alter table public.accounts alter column balance set default 0;

comment on column public.accounts.opening_balance is 'Остаток на начало opening_date; текущий остаток = opening_balance + факты с opening_date';
comment on column public.accounts.opening_date is 'Дата, с которой остаток ведётся по платежам';
