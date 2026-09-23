-- «Доставок, шт» в «Маржа по артикулам» — отдельное поле WB API (deliveryAmount),
-- не совпадает с quantity. Раньше не запрашивалось у WB и не хранилось.
alter table wb_report_rows
  add column if not exists delivery_amount integer;
