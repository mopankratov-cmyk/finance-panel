-- История ДДС загружается отдельными файлами. Поэтому две стороны одного
-- перевода появляются в базе не одновременно и прежний импорт оставлял их
-- несвязанными, хотя дата, сумма и кошельки однозначно совпадали.
--
-- Связываем только безопасные пары:
--   * обе строки пришли из файлов ДДС и ещё не входят в цепочку/пару;
--   * дата и сумма до копеек совпадают, знаки и статьи согласованы;
--   * кошельки разные;
--   * назначения совпадают либо одна сторона содержит стандартное название
--     статьи, а вторая прямо говорит о переводе собственных средств;
--   * для каждой стороны существует ровно один кандидат;
--   * обе стороны относятся к одному контуру либо к компаниям основной
--     группы. Основная группа ↔ ИП Филиппов здесь намеренно исключено:
--     такой перевод должен оформляться займом, а не исчезать как технический.

create or replace function public.link_unlinked_dds_transfers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('link-unlinked-dds-transfers', 0));

  with eligible as (
    select
      p.id,
      p.date,
      round(p.amount::numeric, 2) amount,
      p.category,
      p.name,
      p.account_id,
      p.company_id,
      p.comment,
      lower(coalesce(c.name, '')) company_name,
      lower(coalesce(c.group_name, '')) company_group
    from public.payments p
    left join public.companies c on c.id = p.company_id
    where p.status = 'done'
      and p.import_source like 'dds-file:%'
      and p.category in (
        'Выбытие — Перевод между счетами',
        'Поступление — Перевод между счетами'
      )
      and coalesce(p.comment, '') not like '%[dds-bank-transfer:%'
      and coalesce(p.comment, '') not like '%[dds-chain:%'
  ), candidates as (
    select
      outgoing.id outgoing_id,
      incoming.id incoming_id,
      count(*) over (partition by outgoing.id) outgoing_candidates,
      count(*) over (partition by incoming.id) incoming_candidates
    from eligible outgoing
    join eligible incoming
      on incoming.date = outgoing.date
     and incoming.amount = -outgoing.amount
     and incoming.account_id <> outgoing.account_id
     and incoming.amount > 0
     and incoming.category = 'Поступление — Перевод между счетами'
     and (
       regexp_replace(lower(coalesce(incoming.name, '')), '\s+', ' ', 'g')
         = regexp_replace(lower(coalesce(outgoing.name, '')), '\s+', ' ', 'g')
       or (
         lower(coalesce(incoming.name, '')) = lower(incoming.category)
         and lower(coalesce(outgoing.name, ''))
               ~ '(перевод собственных средств|между своими счетами|в наличн|на карт|на счет|на счёт)'
       )
       or (
         lower(coalesce(outgoing.name, '')) = lower(outgoing.category)
         and lower(coalesce(incoming.name, ''))
               ~ '(перевод собственных средств|между своими счетами|из наличн|с карт|со счет|со счёт)'
       )
     )
    where outgoing.amount < 0
      and outgoing.category = 'Выбытие — Перевод между счетами'
      and (
        (outgoing.company_id is null and incoming.company_id is null)
        or outgoing.company_id = incoming.company_id
        or (
          outgoing.company_id is not null
          and incoming.company_id is not null
          and (outgoing.company_name || ' ' || outgoing.company_group)
                ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
          and (incoming.company_name || ' ' || incoming.company_group)
                ~ '(основн|рио|митриченко|панкратов|кучеренко|глобалкос|иллюмей)'
          and (outgoing.company_name || ' ' || outgoing.company_group)
                !~ '(филиппов|коровкин)'
          and (incoming.company_name || ' ' || incoming.company_group)
                !~ '(филиппов|коровкин)'
        )
      )
  ), safe_pairs as (
    select outgoing_id, incoming_id, least(outgoing_id::text, incoming_id::text) pair_id
    from candidates
    where outgoing_candidates = 1 and incoming_candidates = 1
  ), markers as (
    select outgoing_id payment_id, pair_id from safe_pairs
    union all
    select incoming_id payment_id, pair_id from safe_pairs
  ), updated as (
    update public.payments p
    set comment = btrim(concat_ws(
      ' ',
      nullif(p.comment, ''),
      '[dds-bank-transfer:' || markers.pair_id || ']'
    ))
    from markers
    where p.id = markers.payment_id
    returning p.id
  )
  select count(*) / 2 into v_linked from updated;

  return jsonb_build_object('linkedPairs', v_linked);
end;
$$;

revoke all on function public.link_unlinked_dds_transfers() from public;
grant execute on function public.link_unlinked_dds_transfers() to service_role;

-- Исправляем уже загруженные общий ДДС и ДДС ИП Филиппова. Повторный запуск
-- безопасен: строки с маркером больше не попадают в eligible.
select public.link_unlinked_dds_transfers();

notify pgrst, 'reload schema';
