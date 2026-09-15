-- §27.5 / §13 ТЗ: «каждый платёж сохраняет свой курс». purchase_orders.exchange_rate
-- один на весь заказ — этапы оплаты своего курса не хранили вовсе.
--
-- Поле не участвует в расчёте purchase_payment_stages.amount (та сумма — в
-- рублях, вводится вручную, см. title="Сумма в рублях" в форме заказа) —
-- пересчитывать уже работающую денежную логику здесь не нужно и рискованно.
-- Это чисто фиксация курса конкретного платежа для истории/аудита, nullable:
-- у старых этапов и у платежей, где курс не отслеживали, останется null.

alter table public.purchase_payment_stages
  add column if not exists exchange_rate numeric(14, 4);

comment on column public.purchase_payment_stages.exchange_rate is
  'Курс на дату именно этого платежа (§13 ТЗ), не курс заказа
   (purchase_orders.exchange_rate — один на весь документ). Не пересчитывает
   amount — то остаётся суммой в рублях, введённой вручную.';
