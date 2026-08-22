-- Соответствие «том WB → номер баскета» в базе, а не в памяти процесса.
--
-- Замер РНП на проде (СЛОЁНО, 7 дней): все запросы к базе завершаются за 7.8
-- секунды, а ответ идёт 27. Разницу съедает wbCardImageUrlsByNmIds — она
-- проверяет баскет каждого тома живыми HEAD-запросами к WB, потому что
-- соответствие кэшируется в Map внутри процесса. На Vercel каждый холодный
-- инстанс лямбды начинает с пустой карты и опрашивает WB заново; у кабинета
-- на 467 артикулов это десятки томов, а проверка идёт последовательно с
-- ретраями (параллельные запросы WB режет).
--
-- Таблица переживает холодные старты: найденный баскет пишется сюда, и
-- следующий запрос берёт его без единого обращения к WB.
create table if not exists public.wb_basket_vols (
  vol        int primary key,
  basket     int not null,
  updated_at timestamptz not null default now()
);

alter table public.wb_basket_vols enable row level security;
revoke all on table public.wb_basket_vols from anon, authenticated;
grant all on table public.wb_basket_vols to service_role;
