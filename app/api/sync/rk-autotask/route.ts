import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowYesterday } from "@/lib/wb/rkJournalDates";
import { computeRkTaskBounds, RK_DEFAULT_BOUNDS, suggestRkTask } from "@/lib/wb/rkAutoTask";

// Автозаполнение задач журнала РК за вчерашний день.
//
// Идёт ПОСЛЕ ночного снимка (sync/rk-journal, 03:00 МСК): снимок фиксирует
// ставку и вид размещения того дня, а без них советовать нечего.
//
// Три правила, которые здесь важнее самих правил совета:
//
//   1. Никогда не затирать человека. Если на клетке уже есть задача — чужая
//      она или наша вчерашняя, — трогать её нельзя. Совет появляется только
//      там, где пусто.
//   2. Молчание — штатный ответ. По разбору рабочей таблицы владельца решения
//      принимаются в 39% дней, а крупные — в 4%. Советчик, пишущий что-то
//      каждый день по каждой строке, превращается в шум и его выключают.
//   3. Границы «дорого» и «дёшево» берутся из истории САМОГО кабинета, а не
//      зашиты числом: у Оптимы и у СЛОЁНО они разные.
export const maxDuration = 120;

/** Сколько дней истории берём, чтобы посчитать границы кабинета. */
const HISTORY_DAYS = 30;

interface SnapshotRow {
  cabinet_id: string;
  nm_id: number;
  advert_id: number | null;
  block: string;
  bid: number | string | null;
  views: number | null;
  spent: number | string | null;
  orders: number | null;
  orders_sum: number | string | null;
}

interface HistoryRow {
  nm_id: number;
  date: string;
  spent: number | string | null;
  spent_allocated: number | string | null;
  orders: number | null;
  orders_sum: number | string | null;
}

const num = (value: number | string | null | undefined) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
};

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const startedAt = new Date();
  const sp = request.nextUrl.searchParams;
  const date = sp.get("date") ?? moscowYesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date должен быть ГГГГ-ММ-ДД" }, { status: 400 });
  }
  // Сухой прогон: посчитать и показать, ничего не записывая. Нужен, чтобы
  // посмотреть на советы до того, как они появятся у людей на экране.
  const dryRun = sp.get("dry") === "1";

  const historyFrom = new Date(`${date}T00:00:00Z`);
  historyFrom.setUTCDate(historyFrom.getUTCDate() - HISTORY_DAYS);
  const historyFromIso = historyFrom.toISOString().slice(0, 10);

  const errors: string[] = [];
  let suggested = 0;
  let skippedTaken = 0;

  try {
    // Снимок нужного дня — источник ставки и вида размещения. Без снимка
    // советовать нельзя: нынешние настройки кампании о вчерашнем дне не
    // свидетельствуют.
    const snapshots = await loadAllSupabasePages<SnapshotRow>(
      (from, to) => db
        .from("wb_rk_journal_daily")
        .select("cabinet_id, nm_id, advert_id, block, bid, views, spent, orders, orders_sum")
        .eq("date", date)
        .order("cabinet_id", { ascending: true })
        .order("nm_id", { ascending: true })
        .order("advert_id", { ascending: true })
        .range(from, to),
      { maxPages: 60, label: "Автозадачи: снимок дня", concurrency: 4 },
    );
    if (!snapshots.length) {
      await writeSyncLog("rk-autotask", "ok", 0, `Снимка за ${date} нет — советовать не по чему`, startedAt);
      return NextResponse.json({ ok: true, date, suggested: 0, note: "нет снимка" });
    }

    const cabinets = [...new Set(snapshots.map((row) => row.cabinet_id).filter(Boolean))];

    // Остатки: рекламировать то, чего нет на складе, советовать нельзя, а
    // пустой остаток — сам по себе задача «Откл до отгрузки».
    const stockRows = await loadAllSupabasePages<{ cabinet_id: string; nm_id: number; quantity: number | null }>(
      (from, to) => db
        .from("wb_stocks")
        .select("cabinet_id, nm_id, quantity")
        .in("cabinet_id", cabinets)
        .order("cabinet_id", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(from, to),
      { maxPages: 60, label: "Автозадачи: остатки", concurrency: 4 },
    ).catch(() => [] as { cabinet_id: string; nm_id: number; quantity: number | null }[]);
    const stockByKey = new Map<string, number>();
    for (const row of stockRows) {
      const key = `${row.cabinet_id}|${row.nm_id}`;
      stockByKey.set(key, (stockByKey.get(key) ?? 0) + num(row.quantity));
    }

    // Уже занятые клетки. Совет появляется только там, где пусто: перезаписать
    // задачу человека значит стереть его решение, а вместе с ним и материал,
    // по которому этот же алгоритм потом чинится.
    const taken = new Set<string>();
    const takenRows = await loadAllSupabasePages<{ cabinet_id: string; nm_id: number; advert_id: number | null }>(
      (from, to) => db
        .from("wb_rk_notes")
        .select("cabinet_id, nm_id, advert_id")
        .eq("date", date)
        .order("cabinet_id", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(from, to),
      { maxPages: 30, label: "Автозадачи: занятые клетки", concurrency: 2 },
    ).catch(() => [] as { cabinet_id: string; nm_id: number; advert_id: number | null }[]);
    for (const row of takenRows) taken.add(`${row.cabinet_id}|${row.nm_id}|${row.advert_id ?? "-"}`);

    // Границы считаются на кабинет и по артикуло-дням: задача ставится на
    // товар, а не на отдельную кампанию, и мерить надо на том же уровне.
    const boundsByCabinet = new Map<string, ReturnType<typeof computeRkTaskBounds>>();
    for (const cabinetId of cabinets) {
      const history = await loadAllSupabasePages<HistoryRow>(
        (from, to) => db
          .from("wb_advert_nm_campaign_daily")
          .select("nm_id, date, spent, spent_allocated, orders, orders_sum")
          .eq("cabinet_id", cabinetId)
          .gte("date", historyFromIso)
          .lt("date", date)
          .order("date", { ascending: true })
          .order("nm_id", { ascending: true })
          .range(from, to),
        { maxPages: 60, label: `Автозадачи: история ${cabinetId}`, concurrency: 4 },
      ).catch((error) => {
        errors.push(`история кабинета: ${error instanceof Error ? error.message : String(error)}`);
        return [] as HistoryRow[];
      });
      const byArticleDay = new Map<string, { spend: number; orders: number; ordersSum: number }>();
      for (const row of history) {
        const key = `${row.nm_id}|${row.date}`;
        const acc = byArticleDay.get(key) ?? { spend: 0, orders: 0, ordersSum: 0 };
        acc.spend += num(row.spent) + num(row.spent_allocated);
        acc.orders += num(row.orders);
        acc.ordersSum += num(row.orders_sum);
        byArticleDay.set(key, acc);
      }
      boundsByCabinet.set(cabinetId, computeRkTaskBounds([...byArticleDay.values()]));
    }

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    /** Одна клетка — одна задача, даже если совет пришёл от нескольких кампаний. */
    const written = new Set<string>();
    const preview: { nm: number; advert: number | null; note: string; reason: string }[] = [];

    for (const snapshot of snapshots) {
      // Занятость проверяем ПОСЛЕ совета: у задачи про товар ключ другой
      // (advert_id = null), и ранняя проверка по ключу кампании отсекала бы
      // «Откл до отгрузки» из-за занятой соседней клетки.
      const bounds = boundsByCabinet.get(snapshot.cabinet_id) ?? RK_DEFAULT_BOUNDS;
      const stock = stockByKey.has(`${snapshot.cabinet_id}|${snapshot.nm_id}`)
        ? stockByKey.get(`${snapshot.cabinet_id}|${snapshot.nm_id}`)!
        : null;
      const suggestion = suggestRkTask({
        block: snapshot.block,
        spent: num(snapshot.spent),
        orders: num(snapshot.orders),
        ordersSum: num(snapshot.orders_sum),
        views: num(snapshot.views),
        bid: snapshot.bid == null ? null : num(snapshot.bid),
        stock,
        bounds,
        // День уже снят — снимок за него и есть доказательство, что он закрыт.
        dayClosed: true,
      });
      if (!suggestion) continue;
      // Задача про ТОВАР пишется один раз, с advert_id = null. Иначе «Откл до
      // отгрузки» дублируется по каждой кампании: прогон по 01.09 дал четыре
      // одинаковых задачи на один артикул только у Retail Family.
      const advertId = suggestion.scope === "article" ? null : snapshot.advert_id;
      const rowKey = `${snapshot.cabinet_id}|${snapshot.nm_id}|${advertId ?? "-"}`;
      if (written.has(rowKey)) continue;
      if (taken.has(rowKey)) { skippedTaken++; continue; }
      written.add(rowKey);
      suggested++;
      if (preview.length < 20) {
        preview.push({ nm: snapshot.nm_id, advert: snapshot.advert_id, note: suggestion.note, reason: suggestion.reason });
      }
      rows.push({
        cabinet_id: snapshot.cabinet_id,
        nm_id: snapshot.nm_id,
        advert_id: advertId,
        date,
        note: suggestion.note,
        done: false,
        source: "auto",
        suggested_note: suggestion.note,
        suggested_reason: suggestion.reason,
        suggested_at: now,
        updated_at: now,
        updated_by: "автозадачи",
      });
    }

    if (!dryRun && rows.length) {
      const upsertError = await chunkedUpsert("wb_rk_notes", rows, "cabinet_id,nm_id,advert_id,date");
      if (upsertError) errors.push(upsertError);
    }

    const note = [
      `дней в снимке ${snapshots.length}`,
      `советов ${suggested}`,
      `клеток занято ${skippedTaken}`,
      ...errors,
    ].join("; ");
    await writeSyncLog("rk-autotask", errors.length ? "error" : "ok", suggested, note, startedAt);
    return NextResponse.json({
      ok: !errors.length,
      date,
      dryRun,
      scanned: snapshots.length,
      suggested,
      skippedTaken,
      bounds: Object.fromEntries(boundsByCabinet),
      preview,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await writeSyncLog("rk-autotask", "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
