import { NextRequest, NextResponse } from "next/server";
import { wbTokenForNm, wbCabinetForNm } from "@/lib/wb/cabinetTokens";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_TEXTS_URL =
  "https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts";
const HISTORY_DAYS = 30;

interface SearchItem {
  text?: string;
  frequency?: { current?: number };
  weekFrequency?: number;
  medianPosition?: { current?: number };
  avgPosition?: { current?: number };
}
interface SnapRow { keyword: string; frequency: number | null; median_position: number | null; snapshot_date: string }

const fmt = (d: Date) => d.toISOString().slice(0, 10);

// Живой запрос поисковых текстов WB (доступен по подписке «Джем»). items или ошибка.
async function fetchLive(nmId: number, token: string, debug: boolean) {
  const body = {
    currentPeriod: { start: fmt(new Date(Date.now() - 13 * 86400000)), end: fmt(new Date()) },
    nmIds: [nmId], topOrderBy: "openCard", orderBy: { field: "openCard", mode: "desc" }, limit: 30, offset: 0,
  };
  let raw: { data?: { items?: SearchItem[] } } | string;
  const res = await fetch(SEARCH_TEXTS_URL, {
    method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const text = await res.text();
  try { raw = JSON.parse(text); } catch { raw = text; }
  if (!res.ok) {
    // WB 403 «Available only in a Jam subscription» — поисковая аналитика за подпиской «Джем»
    const detail = typeof raw === "object" && raw && "detail" in raw ? String((raw as { detail?: unknown }).detail ?? "") : "";
    const msg = res.status === 403 || /jam/i.test(detail)
      ? "Поисковая аналитика WB — только по подписке «Джем» (Аналитика → Джем в кабинете WB этого юрлица). Без неё позиции по запросам недоступны."
      : `WB ${res.status}`;
    return { error: msg, status: res.status, raw: debug ? raw : undefined };
  }
  return { items: (typeof raw === "object" && raw.data?.items) || [] };
}

// Поисковые запросы по товару: частотность WB + позиция ПО ДНЯМ.
// WB отдаёт только медиану за период (без посуточной истории) → копим снимок раз в день
// в wb_seo_positions; читаем историю оттуда, сегодняшний день — лениво до-сохраняем.
// Контракт inferno: {words:[{keyword,shows,daily:[{pos}]}], days:[YYYY-MM-DD,...]}.
export async function GET(req: NextRequest, ctx: { params: Promise<{ nm: string }> }) {
  const { nm } = await ctx.params;
  const nmId = Number(nm);
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (!nmId) return NextResponse.json({ words: [], days: [] });

  const db = getSupabaseAdmin();
  const today = fmt(new Date());
  const fromDate = fmt(new Date(Date.now() - HISTORY_DAYS * 86400000));

  // 1) история из таблицы (если таблицы ещё нет — вернётся ошибка, тихо считаем пусто)
  let snaps: SnapRow[] = [];
  if (db) {
    const { data } = await db
      .from("wb_seo_positions")
      .select("keyword, frequency, median_position, snapshot_date")
      .eq("nm_id", nmId).gte("snapshot_date", fromDate).order("snapshot_date");
    snaps = (data ?? []) as SnapRow[];
  }
  const haveToday = snaps.some((s) => s.snapshot_date.slice(0, 10) === today);

  // 2) нет сегодняшнего снимка → живой запрос WB + до-сохранение (накопление истории)
  let liveErr: { error: string } | null = null;
  if (!haveToday) {
    const token = await wbTokenForNm(nmId, "analytics");
    if (!token) liveErr = { error: "WB-токен не настроен" };
    else {
      try {
        const live = await fetchLive(nmId, token, debug);
        if ("items" in live) {
          const cab = await wbCabinetForNm(nmId);
          const rows = (live.items ?? []).map((it) => ({
            nm_id: nmId,
            keyword: it.text || "",
            frequency: it.frequency?.current ?? it.weekFrequency ?? 0,
            median_position: it.medianPosition?.current ?? it.avgPosition?.current ?? null,
            cabinet_id: cab?.id ?? null,
            snapshot_date: today,
            synced_at: new Date().toISOString(),
          })).filter((r) => r.keyword);
          // пишем снимок (если таблицы нет — upsert вернёт error, игнорируем)
          if (db && rows.length) await db.from("wb_seo_positions").upsert(rows, { onConflict: "nm_id,keyword,snapshot_date" });
          // в ответ сегодня показываем независимо от записи
          snaps = snaps.concat(rows.map((r) => ({ keyword: r.keyword, frequency: r.frequency, median_position: r.median_position, snapshot_date: today })));
        } else {
          liveErr = { error: live.error };
        }
      } catch (e) { liveErr = { error: String(e) }; }
    }
  }

  if (debug) return NextResponse.json({ snaps: snaps.length, haveToday, liveErr, resolved_cabinet: await wbCabinetForNm(nmId) });

  // 3) сборка ответа из снимков (история по дням)
  if (!snaps.length) return NextResponse.json({ words: [], days: [], error: liveErr?.error });

  const days = [...new Set(snaps.map((s) => s.snapshot_date.slice(0, 10)))].sort();
  const byKw = new Map<string, { freq: number; pos: Map<string, number | null> }>();
  for (const s of snaps) {
    const e = byKw.get(s.keyword) ?? { freq: 0, pos: new Map<string, number | null>() };
    e.freq = Math.max(e.freq, Number(s.frequency ?? 0));
    e.pos.set(s.snapshot_date.slice(0, 10), s.median_position);
    byKw.set(s.keyword, e);
  }
  const words = [...byKw.entries()]
    .sort((a, b) => b[1].freq - a[1].freq)
    .slice(0, 30)
    .map(([kw, e]) => ({ keyword: kw, shows: e.freq, daily: days.map((d) => ({ pos: e.pos.get(d) ?? null })) }));

  return NextResponse.json({ words, days, note: liveErr?.error });
}
