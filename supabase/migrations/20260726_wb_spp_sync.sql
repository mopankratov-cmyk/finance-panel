-- Store WB SPP as a first-class fact.
-- `spp` can be absent in provider rows, so NULL means "WB did not return it",
-- not a real 0% discount.

alter table if exists public.wb_orders
  add column if not exists price_with_disc numeric,
  add column if not exists spp numeric;

alter table if exists public.wb_sales
  add column if not exists price_with_disc numeric,
  add column if not exists spp numeric;

comment on column public.wb_orders.price_with_disc is 'WB order price before SPP: priceWithDisc or totalPrice * (1 - discountPercent / 100) fallback.';
comment on column public.wb_orders.spp is 'WB SPP percent from supplier orders API. NULL means the provider did not return the value.';
comment on column public.wb_sales.price_with_disc is 'WB sale price before SPP: priceWithDisc or totalPrice * (1 - discountPercent / 100) fallback.';
comment on column public.wb_sales.spp is 'WB SPP percent from supplier sales API. NULL means the provider did not return the value.';
