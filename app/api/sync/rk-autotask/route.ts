import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowYesterday } from "@/lib/wb/rkJournalDates";
import { isPlannerSuggestion, planDailyRkTask, RK_MAX_CARRY_DAYS, type RkYesterdayTask } from "@/lib/wb/rkDailyTasks";

// Ежедневная простановка задач журнала РК за вчерашний день.
//
// Идёт ПОСЛЕ ночного снимка (sync/rk-journal, 03:00 МСК): снимок говорит, по
// каким товарам реклама вчера вообще шла.
//
// Правила живут в lib/wb/rkDailyTasks.ts и выведены из рабочей таблицы
// «Показы CTR CPC» — 6 213 решений менеджеров за 120 дней. Коротко: переносим
// вчерашнее решение, а перебиваем его только нулевым остатком. Сверка
// 12.09.2026 показала, что прежний советчик двигал ставку, а ставку руками в
// августе меняли 26 раз из 4 401 решения, и направление совпадало раз на 491.
//
// Три правила, которые здесь важнее самих правил совета:
//
//   1. Никогда не затирать человека. Если на клетке уже есть задача — чужая
//      она или наша вчерашняя, — трогать её нельзя. Совет появляется только
//      там, где пусто.
//   2. Молчание — штатный ответ. Товар, по которому вчера задачи не было и
//      остаток в порядке, остаётся без совета: журнал в сотни строк, где
//      подписана каждая, читать перестают.
//   3. Совет, к которому человек не притрагивался, не живёт дольше двух недель.
export const maxDuration = 120;

/**
 * Сколько дней назад смотрим, чтобы понять, сколько дней задача уже переносится.
 * Чуть больше потолка переноса — иначе длину серии не измерить.
 */
const HISTORY_DAYS = RK_MAX_CARRY_DAYS + 2;

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

interface NoteRow {
  cabinet_id: string;
  nm_id: number;
  advert_id: number | null;
  date: string;
  note: string | null;
  source: string | null;
  suggested_reason: string | null;
}

/** Сдвиг календарной даты. Считаем в UTC: зона сервера не должна двигать день. */
const shiftIso = (iso: string, days: number): string => {
  const at = new Date(`${iso}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

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
  /** Сколько задач перенеслось со вчера — по нему видно, живёт ли цепочка. */
  let carried = 0;

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
    /**
     * История задач за две недели с хвостиком.
     *
     * Читается ДО проверки снимка намеренно. Перенос вчерашнего решения не
     * зависит от вчерашних цифр: задача говорит, что делать сегодня, а не
     * объясняет прошедший день. Если ночной снимок не собрался, цепочка задач
     * рваться не должна — люди свою работу из-за нашего сбоя не прекращают.
     */
    const noteRows = await loadAllSupabasePages<NoteRow>(
      (from, to) => db
        .from("wb_rk_notes")
        .select("cabinet_id, nm_id, advert_id, date, note, source, suggested_reason")
        .gte("date", historyFromIso)
        .lt("date", date)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(from, to),
      { maxPages: 60, label: "Автозадачи: история задач", concurrency: 4 },
    ).catch((error) => {
      errors.push(`история задач: ${error instanceof Error ? error.message : String(error)}`);
      return [] as NoteRow[];
    });

    const cabinets = [...new Set([
      ...snapshots.map((row) => row.cabinet_id),
      ...noteRows.map((row) => row.cabinet_id),
    ].filter(Boolean))];
    if (!cabinets.length) {
      await writeSyncLog("rk-autotask", "ok", 0, `Ни снимка, ни задач за ${date} — ставить нечего`, startedAt);
      return NextResponse.json({ ok: true, date, suggested: 0, note: "нет ни снимка, ни вчерашних задач" });
    }

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

    const cellKey = (cabinetId: string, nmId: number, advertId: number | null) =>
      `${cabinetId}|${nmId}|${advertId ?? "-"}`;
    const byCell = new Map<string, NoteRow[]>();
    for (const row of noteRows) {
      if (!String(row.note ?? "").trim()) continue;
      // Предложения отменённых правил про ставку не переносим: иначе прогон
      // сам себя бы и поддерживал в том, от чего мы уходим.
      if (row.source === "auto" && !isPlannerSuggestion(row.suggested_reason)) continue;
      const key = cellKey(row.cabinet_id, row.nm_id, row.advert_id);
      const list = byCell.get(key) ?? [];
      list.push(row);
      byCell.set(key, list);
    }

    const yesterdayIso = shiftIso(date, -1);
    const yesterdayByCell = new Map<string, RkYesterdayTask>();
    for (const [key, list] of byCell) {
      const sorted = [...list].sort((left, right) => left.date.localeCompare(right.date));
      const last = sorted.at(-1);
      // Только ВЧЕРАШНЯЯ задача переносится: разрыв в днях означает, что товар
      // выпал из работы, и тянуть недельной давности решение нельзя.
      if (!last || last.date !== yesterdayIso) continue;
      const note = String(last.note).trim();
      // Длина серии: сколько дней подряд стоит тот же текст и его не трогал
      // человек. Прерывается и сменой текста, и любым днём без задачи.
      let carriedDays = 0;
      let cursor = yesterdayIso;
      for (let index = sorted.length - 1; index >= 0; index--) {
        const row = sorted[index];
        if (row.date !== cursor || String(row.note).trim() !== note || row.source === "human") break;
        carriedDays += 1;
        cursor = shiftIso(cursor, -1);
      }
      yesterdayByCell.set(key, {
        note,
        source: last.source === "auto" ? "auto" : "human",
        carriedDays,
      });
    }

    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    const preview: { nm: number; advert: number | null; note: string; reason: string }[] = [];

    /**
     * Клетки-кандидаты.
     *
     * Две группы. Первая — товары, по которым вчера шла реклама: по ним
     * работает правило остатка. Вторая — все клетки, где вчера стояла задача,
     * включая клетки кампаний: если человек вчера написал задачу конкретной
     * кампании, перенести её надо туда же, а не на товар целиком.
     *
     * Правило остатка при этом остаётся ТОВАРНЫМ: остаток общий, и задача
     * «Откл до отгрузки», продублированная по каждой кампании, превращается в
     * шум — прогон по 01.09 давал четыре одинаковых задачи на один артикул.
     */
    interface Candidate { cabinetId: string; nmId: number; advertId: number | null; advertised: boolean }
    const candidates = new Map<string, Candidate>();
    for (const snapshot of snapshots) {
      const key = cellKey(snapshot.cabinet_id, snapshot.nm_id, null);
      const current = candidates.get(key)
        ?? { cabinetId: snapshot.cabinet_id, nmId: snapshot.nm_id, advertId: null, advertised: false };
      current.advertised = current.advertised || num(snapshot.views) > 0 || num(snapshot.spent) > 0;
      candidates.set(key, current);
    }
    for (const [key, task] of yesterdayByCell) {
      if (candidates.has(key)) continue;
      const parts = key.split("|");
      const advertId = parts[2] === "-" ? null : Number(parts[2]);
      candidates.set(key, { cabinetId: parts[0], nmId: Number(parts[1]), advertId, advertised: Boolean(task) });
    }

    /**
     * За какие дни остаток вообще что-то значит.
     *
     * Остатки мы храним одним срезом — на сейчас, истории по датам нет. Для
     * вчерашнего и сегодняшнего дня это годная замена: за сутки склад меняется
     * мало. Для позапрошлой недели — нет, и правило написало бы в те дни
     * неправду: сухой прогон 12.09.2026 давал 42 задачи «Вкл» на 10 сентября
     * только потому, что остаток есть СЕГОДНЯ.
     *
     * Поэтому при прогоне за прошедшие дни остаток считается неизвестным, и
     * работает один перенос. Ночной прогон идёт за вчера и этого не замечает.
     */
    const stockKnown = date >= shiftIso(moscowYesterday(), 0);

    for (const candidate of candidates.values()) {
      const key = cellKey(candidate.cabinetId, candidate.nmId, candidate.advertId);
      const stock = stockKnown && candidate.advertId === null && stockByKey.has(`${candidate.cabinetId}|${candidate.nmId}`)
        ? stockByKey.get(`${candidate.cabinetId}|${candidate.nmId}`)!
        : null;
      const task = planDailyRkTask({
        yesterday: yesterdayByCell.get(key) ?? null,
        stock,
        advertised: candidate.advertised,
      });
      if (!task) continue;
      if (taken.has(key)) { skippedTaken++; continue; }
      suggested++;
      if (task.reason.startsWith("Перенос")) carried++;
      if (preview.length < 20) {
        preview.push({ nm: candidate.nmId, advert: candidate.advertId, note: task.note, reason: task.reason });
      }
      rows.push({
        cabinet_id: candidate.cabinetId,
        nm_id: candidate.nmId,
        advert_id: candidate.advertId,
        date,
        note: task.note,
        done: false,
        source: "auto",
        suggested_note: task.note,
        suggested_reason: task.reason,
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
      `перенесено ${carried}`,
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
      // Сколько задач перенеслось со вчера, а сколько поставил остаток —
      // по этим двум числам видно, работает ли прогон вообще.
      carried,
      byStock: suggested - carried,
      preview,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    await writeSyncLog("rk-autotask", "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
