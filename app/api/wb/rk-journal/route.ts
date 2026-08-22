import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { moscowToday } from "@/lib/wb/rkJournalDates";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { buildRkJournalItems } from "@/lib/wb/rkJournalRows";

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
  const gate = await requireApiSession([...READ_ROLES]);
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

  const daysRaw = Number(sp.get("days") ?? DAYS_DEFAULT);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 1), DAYS_MAX) : DAYS_DEFAULT;
  const todayMsk = moscowToday();
  const to = sp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") as string) ? (sp.get("to") as string) : todayMsk;
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const from = fromDate.toISOString().slice(0, 10);
  const dates = dayList(from, to);

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
  ).catch(noteOn("кампании")) as AdvertRow[];

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
  const snapshots = await loadSnapshots(`${snapshotColumns}, spent_allocated`)
    .catch((err) => missingAllocatedColumn(err) ? loadSnapshots(snapshotColumns) : Promise.reject(err))
    .catch(noteOn("снимки")) as JournalRow[];

  const snapshotDates = new Set(snapshots.map((row) => row.date));
  const liveDates = dates.filter((date) => !snapshotDates.has(date));

  // Дни без снимка — из слоя кампаний.
  let live: CampaignDayRow[] = [];
  if (liveDates.length) {
    const liveColumns = "cabinet_id, advert_id, nm_id, date, views, clicks, spent, carts, orders, orders_sum";
    const loadLive = (columns: string) => loadAllSupabasePages<CampaignDayRow>(
      (start, end) => {
        const q = db
          .from("wb_advert_nm_campaign_daily")
          .select(columns)
          .in("date", liveDates);
        return (cabinetId ? q.eq("cabinet_id", cabinetId) : q)
          .order("date", { ascending: true })
          .range(start, end) as unknown as PromiseLike<{ data: CampaignDayRow[] | null; error: { message: string } | null }>;
      },
      { maxPages: 120, label: "Журнал РК: дни без снимка", concurrency: 4 },
    );
    live = await loadLive(`${liveColumns}, spent_allocated`)
      .catch((err) => missingAllocatedColumn(err) ? loadLive(liveColumns) : Promise.reject(err))
      .catch(noteOn("статистика кампаний")) as CampaignDayRow[];
  }

  const items = buildRkJournalItems(snapshots, live, adverts);

  return NextResponse.json({
    from,
    to,
    dates,
    items,
    snapshotDates: [...snapshotDates].sort(),
    notes,
  });
}
