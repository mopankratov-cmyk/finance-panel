import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionOrMachine } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday } from "@/lib/wb/rkJournalDates";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { buildRkJournalItems, chooseRkDaySources, rkAdvertBlock } from "@/lib/wb/rkJournalRows";
import type { WbRkBlock } from "@/lib/wb/advertBlocks";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const READ_ROLES = ["director", "finance", "manager", "seller"] as const;
const DAYS_DEFAULT = 5;
const DAYS_MAX = 60;

// Журнал РК: строка = (артикул, вид размещения), колонки = дни.
//
// Источников два, и это осознанно. Закрытые дни берём из снимков 06:00 —
// в них зафиксирована ставка того дня, восстановить её иначе нельзя. Дни, на
// которые снимка ещё нет (сегодня и вся история до внедрения журнала),
// считаются на лету из слоя кампаний: без ставки, но с честными метриками.

interface JournalRow {
  cabinet_id: string | null;
  date: string;
  nm_id: number;
  advert_id: number | null;
  block: string;
  bid: number | string | null;
  views: number | null;
  clicks: number | null;
  spent: number | string | null;
  spent_allocated?: number | string | null;
  carts: number | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface CampaignDayRow {
  cabinet_id: string | null;
  advert_id: number;
  nm_id: number;
  date: string;
  views: number | null;
  clicks: number | null;
  spent: number | string | null;
  spent_allocated?: number | string | null;
  carts: number | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface AdvertRow {
  cabinet_id: string | null;
  advert_id: number;
  name: string | null;
  status: number | null;
  bid_type: string | null;
  payment_type?: string | null;
  placement_search?: boolean | null;
  placement_shelf?: boolean | null;
  bid_cpm_rub: number | string | null;
  bid_search_rub: number | string | null;
  bid_shelf_rub: number | string | null;
  block_override: string | null;
  nm_ids: number[] | null;
}

/** Миграция раскладки расхода могла ещё не примениться. */
function missingAllocatedColumn(err: unknown): boolean {
  return /spent_allocated/i.test(err instanceof Error ? err.message : String(err));
}

/** То же для колонок снимка, которые приходят отдельными миграциями. */
function missingSnapshotColumn(err: unknown): boolean {
  return /spent_allocated|advert_id/i.test(err instanceof Error ? err.message : String(err));
}

function dayList(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end && days.length <= DAYS_MAX) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSessionOrMachine(request, [...READ_ROLES]);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Сервис данных временно недоступен" }, { status: 503 });

  const sp = new URL(request.url).searchParams;
  const cabinetParam = sp.get("cabinet");
  const cabinetId = cabinetParam && cabinetParam !== "all" ? cabinetParam : null;
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  // Сбои источников не превращаем в тихие нули: экран должен сказать, что
  // именно не прочиталось, иначе «журнал пустой» и «журнал сломан» выглядят
  // одинаково.
  const notes: string[] = [];
  const noteOn = (label: string) => (err: unknown) => {
    notes.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  };

  // Период задаётся календарём (from/to); days остаётся для старых ссылок.
  const iso = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const todayMsk = moscowToday();
  const to = iso(sp.get("to")) ?? todayMsk;
  const daysRaw = Number(sp.get("days") ?? DAYS_DEFAULT);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), DAYS_MAX) : DAYS_DEFAULT;
  const fallbackFrom = new Date(`${to}T00:00:00Z`);
  fallbackFrom.setUTCDate(fallbackFrom.getUTCDate() - (days - 1));
  const requestedFrom = iso(sp.get("from")) ?? fallbackFrom.toISOString().slice(0, 10);
  // Окно шире предела режем с начала: хвост ближе к сегодня полезнее.
  const earliest = new Date(`${to}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - (DAYS_MAX - 1));
  const from = requestedFrom < earliest.toISOString().slice(0, 10)
    ? earliest.toISOString().slice(0, 10)
    : requestedFrom > to ? to : requestedFrom;
  const dates = dayList(from, to);

  // Справочник мог не прочитаться. Тогда «таких кампаний у кабинета нет» —
  // не факт, а домысел, и утверждать его нельзя.
  let advertsKnown = false;
  // Кампании нужны, чтобы разложить дни без снимка по видам размещения.
  // Запрос строится внутри колбэка: builder PostgREST одноразовый, повторное
  // использование одного объекта на вторую страницу молча ломает выборку.
  const adverts = await loadAllSupabasePages<AdvertRow>(
    (start, end) => {
      const q = db
        .from("wb_adverts")
        .select("cabinet_id, advert_id, name, status, bid_type, payment_type, placement_search, placement_shelf, bid_cpm_rub, bid_search_rub, bid_shelf_rub, block_override, nm_ids");
      return (cabinetId ? q.eq("cabinet_id", cabinetId) : q).order("advert_id", { ascending: true }).range(start, end);
    },
    { maxPages: 60, label: "Журнал РК: кампании", concurrency: 4 },
  ).then((rows) => { advertsKnown = true; return rows; }).catch(noteOn("кампании")) as AdvertRow[];

  // Снимки закрытых дней.
  // Колонка раскладки появляется отдельной миграцией. Пока её нет, читаем без
  // неё: журнал должен показывать измеренный расход, а не пустоту.
  const snapshotColumns = "cabinet_id, date, nm_id, block, bid, views, clicks, spent, carts, orders, orders_sum";
  const loadSnapshots = (columns: string) => loadAllSupabasePages<JournalRow>(
    (start, end) => {
      const q = db
        .from("wb_rk_journal_daily")
        .select(columns)
        .gte("date", from)
        .lte("date", to);
      return (cabinetId ? q.eq("cabinet_id", cabinetId) : q)
        .order("date", { ascending: true })
        .range(start, end) as unknown as PromiseLike<{ data: JournalRow[] | null; error: { message: string } | null }>;
    },
    { maxPages: 60, label: "Журнал РК: снимки", concurrency: 4 },
  );
  // Колонки прибывают отдельными миграциями: сначала пробуем полный набор,
  // затем отбрасываем недостающую. Без снимка по кампаниям день просто
  // соберётся из слоя как живой — это лучше красной плашки на весь экран.
  const snapshots = await loadSnapshots(`${snapshotColumns}, advert_id, spent_allocated`)
    .catch((err) => missingSnapshotColumn(err)
      ? loadSnapshots(`${snapshotColumns}, spent_allocated`).catch((second) => missingSnapshotColumn(second)
        ? loadSnapshots(snapshotColumns)
        : Promise.reject(second))
      : Promise.reject(err))
    .catch(noteOn("снимки")) as JournalRow[];

  // Слой кампаний читаем за ВЕСЬ период, а не только за дни без снимка.
  // «Есть строка снимка» не значит «день закрыт»: снимок делается в 06:00, а
  // синк статистики обходит кампании срезами и к этому часу успевает пройти
  // лишь первые несколько сотен. Кто из двух источников за какой день правдивее,
  // решает chooseRkDaySources по фактическому покрытию — здесь мы обязаны лишь
  // дать ему обе стороны.
  let live: CampaignDayRow[] = [];
  let liveKnown = false;
  if (dates.length) {
    const liveColumns = "cabinet_id, advert_id, nm_id, date, views, clicks, spent, carts, orders, orders_sum";
    const loadLive = (columns: string) => loadAllSupabasePages<CampaignDayRow>(
      (start, end) => {
        const q = db
          .from("wb_advert_nm_campaign_daily")
          .select(columns)
          .in("date", dates);
        return (cabinetId ? q.eq("cabinet_id", cabinetId) : q)
          .order("date", { ascending: true })
          .order("advert_id", { ascending: true })
          .order("nm_id", { ascending: true })
          .range(start, end) as unknown as PromiseLike<{ data: CampaignDayRow[] | null; error: { message: string } | null }>;
      },
      { maxPages: 240, label: "Журнал РК: слой кампаний", concurrency: 4 },
    );
    live = await loadLive(`${liveColumns}, spent_allocated`)
      .catch((err) => missingAllocatedColumn(err) ? loadLive(liveColumns) : Promise.reject(err))
      .then((rows) => { liveKnown = true; return rows; })
      .catch(noteOn("статистика кампаний")) as CampaignDayRow[];
  }
  // Слой не прочитался — значит проверить полноту снимков нечем. Тогда журнал
  // ведёт себя по-старому (снимок = источник), но молчать об этом нельзя:
  // именно так и выглядит занижение расхода, ради которого всё затевалось.
  if (!liveKnown) {
    notes.push("Слой кампаний не прочитался: полноту снятых дней проверить нечем, цифры могут быть занижены. Сузьте период и повторите.");
  }

  // Товарный контур кабинета. Все остальные экраны WB сужают факты до своих
  // товаров, а журнал не сужал ничего — у агентского кабинета в него попадали
  // чужие артикулы, и расход за день расходился с РНП именно на них.
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const inScope = <T extends { nm_id: number }>(rows: T[]) =>
    rows.filter((row) => requestAllowsNm(allowedNmIds, Number(row.nm_id)));

  // «Снят» — день, который снимок покрыл ЦЕЛИКОМ, а не день, за который снимок
  // хоть что-то записал. Решение считается на НЕСОКРАЩЁННЫХ строках: посчитав
  // его после товарного контура, мы делали цифры дня зависимыми от того, кто
  // смотрит — у селлера с узкой выборкой день «замерзал» на 06:00, а у
  // директора нет.
  const sources = chooseRkDaySources(snapshots, live);
  const items = buildRkJournalItems(inScope(snapshots), inScope(live), adverts, sources);
  const { snapshotDates } = sources;
  // Снимок без advert_id склеить со слоем нечем: сборщик такие строки за
  // живые дни молча пропускает, чтобы не задвоить расход. Молчать об этом
  // нельзя — часть снятых ставок на экран не попадёт.
  if (snapshots.length && snapshots.every((row) => row.advert_id == null)) {
    notes.push("Снимки прочитаны без разбивки по кампаниям (миграция ещё не применена): ставки за снятые дни показаны не везде.");
  }

  // Какие виды размещения у кабинета есть в принципе. Без этого пустая карточка
  // не отличает «таких кампаний тут нет вовсе» от «есть, но за период не
  // тратили» — и одинаково пишет «нет кампаний» в обоих случаях.
  // null — «не знаем»: справочник не прочитался, и утверждать, что вида нет,
  // нельзя. Пустой массив значил бы «проверили, таких кампаний нет».
  const blocksInCabinet = advertsKnown
    ? [...new Set(
      adverts
        // Считаем только по кампаниям, попавшим в товарный контур: иначе на
        // агентском кабинете чужие кампании обещают вид, которого у нас нет.
        .filter((advert) => (advert.nm_ids ?? []).some((nm) => requestAllowsNm(allowedNmIds, Number(nm))) || (advert.nm_ids ?? []).length === 0)
        .map((advert) => rkAdvertBlock(advert))
        .filter((block): block is WbRkBlock => block != null),
    )]
    : null;

  return NextResponse.json({
    from,
    to,
    dates,
    items,
    snapshotDates,
    // День, за который снимок есть, но неполон: метрики уже из слоя, а ставки
    // всё ещё из снимка. Раньше это состояние называлось «снят» — и именно оно
    // и занижало расход вчетверо.
    partialDates: [...new Set(snapshots.map((row) => row.date))]
      .filter((date) => !snapshotDates.includes(date))
      .sort(),
    blocksInCabinet,
    notes,
  });
}
