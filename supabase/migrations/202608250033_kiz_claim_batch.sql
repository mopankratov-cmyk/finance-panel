-- Захват кодов под документ вывода. ОДНА функция на файл.
--
-- Почему это делает база, а не приложение.
--
-- Первое — гонка. Пометка «отправлено» необратима: помеченный код второй раз не
-- соберётся. Если читать список одним запросом, а помечать другим, два
-- одновременных нажатия «Собрать файл» получают ОДИН И ТОТ ЖЕ набор кодов в двух
-- документах, и один код уезжает на вывод дважды. Здесь отбор и пометка — один
-- оператор UPDATE, и второй вызов увидит уже занятое.
--
-- Второе — длина запроса. Код маркировки 31 символ; фильтр «код в списке» на
-- три сотни кодов даёт URL под десять тысяч знаков, и шлюз его не принимает.
-- В соседних местах реестра это уже обходят пачками по сорок, но сорок кодов за
-- запрос при документе на тридцать тысяч — это семьсот пятьдесят запросов подряд.
-- Здесь список не покидает базу вовсе.
--
-- Порядок отбора — по дате продажи: если кодов больше, чем влезает в документ,
-- в партию обязаны попасть самые старые. Иначе просроченные ждали бы за свежими
-- потому лишь, что их артикул начинается на другую букву.

create or replace function public.kiz_claim_batch(p_entity uuid, p_limit integer, p_batch uuid)
returns table (
  code text,
  raw_code text,
  price numeric,
  article text,
  task_id text,
  sold_at date,
  nm_id bigint
)
language sql
security definer
set search_path = public
as $fn$
  update public.kiz_withdrawals w
     set status = 'sent',
         batch_id = p_batch,
         sent_at = now(),
         updated_at = now()
   where w.code in (
     select c.code
       from public.kiz_withdrawals c
      where c.status = 'sold'
        and c.legal_entity_id = p_entity
      order by c.sold_at asc nulls last, c.code asc
      limit greatest(1, least(coalesce(p_limit, 30000), 30000))
   )
     and w.status = 'sold'
     and w.legal_entity_id = p_entity
  returning w.code, w.raw_code, w.price, w.article, w.task_id, w.sold_at, w.nm_id;
$fn$;

revoke all on function public.kiz_claim_batch(uuid, integer, uuid) from public;
grant execute on function public.kiz_claim_batch(uuid, integer, uuid) to service_role;

notify pgrst, 'reload schema';
