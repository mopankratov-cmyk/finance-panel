-- Отдельно учитываем фактическую уплату НДС из ДДС. ЕНП не размечается
-- автоматически: пользователь должен указать, какая его часть относится к НДС.

alter table public.payment_tax_details
  drop constraint if exists payment_tax_details_tax_payment_kind_check,
  add constraint payment_tax_details_tax_payment_kind_check check (
    tax_payment_kind in (
      'operating_expense',
      'insurance_contribution',
      'usn_tax_payment',
      'vat_tax_payment',
      'other_tax'
    )
  );

comment on column public.payment_tax_details.tax_payment_kind is
  'Назначение платежа для налогового расчёта: обычный расход, страховой взнос, уплата УСН, уплата НДС или прочий налог/ЕНП.';
