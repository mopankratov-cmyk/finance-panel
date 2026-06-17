import { NextRequest, NextResponse } from "next/server";
import { wbTokenForNm, wbCabinetForNm } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_TEXTS_URL =
  "https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts";

// Поисковые запросы по товару (частотность WB + позиция). Контракт inferno: {words:[{keyword,shows,daily:[{pos}]}], days:[]}.
export async function GET(req: NextRequest, ctx: { params: Promise<{ nm: string }> }) {
  const { nm } = await ctx.params;
  const nmId = Number(nm);
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (!nmId) return NextResponse.json({ words: [], days: [] });
  // токен кабинета-владельца SKU (по cabinet_id) — иначе чужой токен даёт 401
  const WB_STATS_TOKEN = await wbTokenForNm(nmId, "analytics");
  if (!WB_STATS_TOKEN) return NextResponse.json({ error: "WB-токен не настроен" });

  const end = new Date();
  const start = new Date(Date.now() - 13 * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const body = {
    currentPeriod: { start: fmt(start), end: fmt(end) },
    nmIds: [nmId],
    topOrderBy: "openCard",
    orderBy: { field: "openCard", mode: "desc" },
    limit: 30,
    offset: 0,
  };

  interface SearchItem {
    text?: string;
    frequency?: { current?: number };
    weekFrequency?: number;
    medianPosition?: { current?: number };
    avgPosition?: { current?: number };
    openCard?: { current?: number };
  }
  let raw: { data?: { items?: SearchItem[] } } | string;
  try {
    const res = await fetch(SEARCH_TEXTS_URL, {
      method: "POST",
      headers: { Authorization: WB_STATS_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    try { raw = JSON.parse(text); } catch { raw = text; }
    if (!res.ok) {
      // WB 403 «Available only in a Jam subscription» — поисковая аналитика за платной подпиской «Джем»
      const detail = typeof raw === "object" && raw && "detail" in raw ? String((raw as { detail?: unknown }).detail ?? "") : "";
      const msg = res.status === 403 || /jam/i.test(detail)
        ? "Поисковая аналитика WB — только по подписке «Джем» (Аналитика → Джем в кабинете WB). Без неё позиции по запросам недоступны."
        : `WB ${res.status}`;
      return NextResponse.json({ error: msg, status: res.status, resolved_cabinet: debug ? await wbCabinetForNm(nmId) : undefined, raw: debug ? raw : undefined });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }

  if (debug) return NextResponse.json({ raw });

  const items = (typeof raw === "object" && raw.data?.items) || [];
  // WB отдаёт позицию агрегатом за период (не по дням) → одна колонка «медианная позиция».
  const today = fmt(end);
  const words = items.map((it) => ({
    keyword: it.text || "",
    shows: it.frequency?.current ?? it.weekFrequency ?? 0,
    daily: [{ pos: it.medianPosition?.current ?? it.avgPosition?.current ?? null }],
  }));
  return NextResponse.json({ words, days: [today] });
}
