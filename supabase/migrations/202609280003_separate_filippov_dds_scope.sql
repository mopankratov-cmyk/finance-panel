-- ИП Филиппов — отдельный финансовый контур. Он не должен попадать в
-- агрегат «Основная группа», иначе общий ДДС смешивается с ДДС Филиппова.
--
-- Миграция не переносит платежи и не меняет другие компании. Повторный
-- запуск безопасен: UPDATE сработает только при отличающемся group_name.

do $separate_filippov_dds_scope$
declare
  v_filippov uuid;
begin
  select id into v_filippov
  from public.companies
  where lower(name) like '%филиппов%'
    and is_active = true
  order by id
  limit 1;

  if v_filippov is null then
    raise exception 'Активная компания ИП Филиппов не найдена';
  end if;

  update public.companies
  set group_name = 'ИП Филиппов'
  where id = v_filippov
    and group_name is distinct from 'ИП Филиппов';
end
$separate_filippov_dds_scope$;
