import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { wbTokenForNm, wbCabinetForNm } from "@/lib/wb/cabinetTokens";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { fetchWbFunnelHistory } from "@/lib/wb/funnelRequest";
import { readWbSyncState } from "@/lib/wb/syncState";
import {
  SEARCH_TEXTS_URL,
  SEO_POSITIONS_JOB,
  loadSeoKeywords,
  searchTextsDayBody,
  type SeoKeywordsDeps,
  type SeoPositionsState,
  type SeoSnapRow,
} from "@/lib/wb/seoPositions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Живой запрос ждёт ответа WB (и одного повтора после 429) не дольше этого: функция живёт 60 с.
const LIVE_BUDGET_MS = 40_000;
const LIVE_RESERVE_MS = 5_000;
const LIVE_RATE_LIMIT_WAIT_MS = 21_000;
const LIVE_REQUEST_TIMEOUT_MS = 25_000;

// Поисковые запросы по товару: частотность WB + позиция ПО ДНЯМ.
// WB отдаёт только медиану за период (без посуточной истории), поэтому ночной крон
// (app/api/sync/seo-positions) мерит ВЧЕРАШНИЙ закрытый день по Москве (start = end) и
// копит значения в wb_seo_positions; здесь история читается оттуда. Сегодняшнего дня в ряду
// нет: пока он не закрыт, WB отдаёт неполные данные. Живой запрос — только если вчерашнего
// замера по товару нет и ночной его не делал: так экран не тратит квоту WB, которой едва
// хватает ночному замеру. Все решения (какие строки показывать, нужен ли живой запрос,
// что написать на пустом экране) живут в lib/wb/seoPositions.ts (loadSeoKeywords) и
// покрыты тестами; роут только достаёт зависимости и отдаёт JSON.
// Контракт inferno: {words:[{keyword,shows,daily:[{pos}]}], days:[YYYY-MM-DD,...]}.
export async function GET(req: NextRequest, ctx: { params: Promise<{ nm: string }> }) {
  const { nm } = await ctx.params;
  const nmId = Number(nm);
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (!nmId) return NextResponse.json({ words: [], days: [] });

  const ownerCabinet = await wbCabinetForNm(nmId);
  if (!(await hasCabinetAccess(ownerCabinet?.id ?? null))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }

  const db = getSupabaseAdmin();
  const deps: SeoKeywordsDeps = {
    now: Date.now,
    // Выборка постраничная: ответ PostgREST молча режется на тысяче строк, а старые и новые строки лежат вперемешку.
    readHistory: async (window) => {
      if (!db) return [];
      return loadAllSupabasePages<SeoSnapRow>((from, to) => db
        .from("wb_seo_positions")
        .select("keyword, frequency, median_position, snapshot_date, synced_at")
        .eq("nm_id", nmId)
        .gte("snapshot_date", window.from)
        .lte("snapshot_date", window.to)
        .order("snapshot_date", { ascending: true })
        .order("keyword", { ascending: true })
        .range(from, to), { label: "История SEO-позиций", maxPages: 20 });
    },
    readState: async () => (db && ownerCabinet ? readWbSyncState<SeoPositionsState>(db, ownerCabinet.id, SEO_POSITIONS_JOB) : null),
    getToken: () => wbTokenForNm(nmId, "analytics"),
    requestLive: async (token, day) => {
      const res = await fetchWbFunnelHistory({
        url: SEARCH_TEXTS_URL,
        token,
        body: searchTextsDayBody([nmId], day),
        deadline: Date.now() + LIVE_BUDGET_MS,
        reserveMs: LIVE_RESERVE_MS,
        fallbackWaitMs: LIVE_RATE_LIMIT_WAIT_MS,
        fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LIVE_REQUEST_TIMEOUT_MS) }),
      });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    writeRows: async (rows) => {
      // Если таблицы нет — upsert вернёт error, экрану это не мешает.
      if (db) await db.from("wb_seo_positions").upsert(rows, { onConflict: "nm_id,keyword,snapshot_date" });
    },
  };

  const { payload, debug: decisions } = await loadSeoKeywords(deps, { nmId, cabinetId: ownerCabinet?.id ?? null });
  if (debug) return NextResponse.json({ ...decisions, resolved_cabinet: ownerCabinet });
  return NextResponse.json(payload);
}
