-- Кабинет Оптимы участвует в агентских схемах других юрлиц, но для Баланса
-- у него обязательно должен быть один собственник. Не удаляем агентские связи:
-- добавляем/исправляем только пару ООО Оптима ↔ кабинет Оптима.
do $balance_optima_owner$
declare
  v_entity_id uuid;
  v_cabinet_id uuid;
begin
  select id into v_entity_id
  from public.legal_entities
  where lower(name) = lower('ООО Оптима') and is_active = true
  order by created_at
  limit 1;

  select id into v_cabinet_id
  from public.wb_cabinets
  where id = 'd43854d4-5bb7-49ac-a7d4-ecd619330c20'::uuid
    and is_active = true
  limit 1;

  if v_entity_id is null then
    raise exception 'Не найдено активное юрлицо ООО Оптима';
  end if;
  if v_cabinet_id is null then
    raise exception 'Не найден активный кабинет Оптима d43854d4-5bb7-49ac-a7d4-ecd619330c20';
  end if;

  insert into public.legal_entity_cabinets (legal_entity_id, cabinet_id, relation)
  values (v_entity_id, v_cabinet_id, 'own')
  on conflict (legal_entity_id, cabinet_id)
  do update set relation = 'own';
end
$balance_optima_owner$;

notify pgrst, 'reload schema';
