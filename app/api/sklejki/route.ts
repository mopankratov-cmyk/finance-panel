import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinetSources } from "@/lib/wb/cabinetTokens";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { allowsProduct, type WbProductScope } from "@/lib/wb/productScope";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface WbCard {
  nmID: number;
  imtID: number;
  vendorCode: string;
  title?: string;
  subjectName?: string;
  brand?: string;
  _shop?: string;
}

interface FunnelRow { nm_id: number; date: string; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; spent: number }
interface RpcTotal { nm_id: number; stock: number; cost: number | null }

const PAGE_SIZE = 1000;
const MAX_DB_PAGES = 30;

const r1 = (v: number) => Math.round(v * 10) / 10;

const EMPTY = { groups_multi: [], groups_solo: [], total_sku: 0, multi_groups: 0, solo_skus: 0, covered: 0 };

// Контракт inferno: {groups_multi, groups_solo, total_sku, multi_groups, solo_skus, covered}.
// ?cabinet=<uuid|all> — карточки тянем токеном Контент каждого кабинета, тегируем кабинетом.
export async function GET(request: NextRequest) {
  const { cabinetId } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const payload = await loadHourlyDashboard(
    "wb-sklejki",
    { cabinetId },
    async () => {
      const sources = await getWbCabinetSources(cabinetId, "content");
      if (!sources.length) return EMPTY;

  // 1) карточки из Content API — по каждому кабинету своим токеном, с тегом кабинета.
  //    Кабинеты независимы (свой токен, свой курсор) — тянем их ПАРАЛЛЕЛЬНО; внутри
  //    одного кабинета страницы курсора остаются последовательными (так требует API).
  const fetchCabinetCards = async (src: { token: string; name: string; productScope: WbProductScope }): Promise<WbCard[]> => {
    const out: WbCard[] = [];
    let cursor: { updatedAt?: string; nmID?: number } = {};
    for (let page = 0; page <= 30; page++) {
      const res = await fetch(CARDS_URL, {
        method: "POST",
        headers: { Authorization: src.token, "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`${src.name}: Content API ${res.status}: ${(await res.text()).slice(0, 180)}`);
      }
      const json = (await res.json()) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number } };
      const batch = json.cards ?? [];
      if (page === 30 && batch.length) {
        throw new Error(`${src.name}: карточек больше безопасного лимита 3000`);
      }
      for (const c of batch) {
        if (!allowsProduct(src.productScope, c.nmID, c.brand)) continue;
        out.push({ ...c, _shop: src.name });
      }
      if (batch.length < 100) break;
      cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
    }
    return out;
  };

  // 2) метрики воронки/рекламы по nm (7д и 14д) из синка — не зависят от карточек,
  //    запускаем ОДНОВРЕМЕННО с их фетчем, а не после.
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const closedFortnight = closedMoscowDates(14);
  const since = closedFortnight[0];
  const week = new Set(closedFortnight.slice(-7));
  const loadFunnelRows = async () => {
    const rows: FunnelRow[] = [];
    for (let page = 0; page < MAX_DB_PAGES; page++) {
      let query = db
        .from("wb_funnel_daily")
        .select("nm_id, date, add_to_cart, orders, orders_sum")
        .gte("date", since)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cabinetId) query = query.eq("cabinet_id", cabinetId);
      const { data, error } = await query;
      if (error) throw new Error(`Воронка WB: ${error.message}`);
      const batch = (data ?? []) as FunnelRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return rows;
    }
    throw new Error(`Воронка WB превысила безопасный лимит ${PAGE_SIZE * MAX_DB_PAGES} строк`);
  };
  const loadAdRows = async () => {
    const rows: AdRow[] = [];
    for (let page = 0; page < MAX_DB_PAGES; page++) {
      let query = db
        .from("wb_advert_nm_daily")
        .select("nm_id, date, views, spent")
        .gte("date", since)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (cabinetId) query = query.eq("cabinet_id", cabinetId);
      const { data, error } = await query;
      if (error) throw new Error(`Реклама WB: ${error.message}`);
      const batch = (data ?? []) as AdRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) return rows;
    }
    throw new Error(`Реклама WB превысила безопасный лимит ${PAGE_SIZE * MAX_DB_PAGES} строк`);
  };
  const metricsPromise = Promise.all([
    loadFunnelRows(),
    loadAdRows(),
    db.rpc("rnp_report", { p_cabinet: cabinetId }),
  ]);

  const [cardsBySource, metricsRes] = await Promise.all([
    Promise.all(sources.map(fetchCabinetCards)),
    metricsPromise,
  ]);
  const cards = cardsBySource.flat();

  // рейтинг/отзывы по SKU — уже наполненная wb_feedbacks (см. раздел /reviews), просто джойн
  const ratingAgg = new Map<number, { sum: number; count: number }>();
  if (cards.length) {
    const nmIds = [...new Set(cards.map((c) => c.nmID))];
    for (let offset = 0; offset < nmIds.length; offset += 100) {
      const chunk = nmIds.slice(offset, offset + 100);
      for (let page = 0; page < MAX_DB_PAGES; page++) {
        const { data, error } = await db
          .from("wb_feedbacks")
          .select("nm_id, rating")
          .in("nm_id", chunk)
          .order("nm_id", { ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (error) throw new Error(`Отзывы WB: ${error.message}`);
        const batch = data ?? [];
        for (const r of batch) {
          const nm = r.nm_id as number;
          const e = ratingAgg.get(nm) ?? { sum: 0, count: 0 };
          e.sum += Number(r.rating ?? 0); e.count += 1;
          ratingAgg.set(nm, e);
        }
        if (batch.length < PAGE_SIZE) break;
        if (page === MAX_DB_PAGES - 1) {
          throw new Error(`Отзывы WB превысили безопасный лимит ${PAGE_SIZE * MAX_DB_PAGES} строк на пачку SKU`);
        }
      }
    }
  }

  const m7 = new Map<number, { views: number; spent: number; cart: number; oc: number; os: number }>();
  const spent14 = new Map<number, number>();
  const totals = new Map<number, RpcTotal>();
  if (metricsRes) {
    const [funnelRows, adRows, tRes] = metricsRes;
    if (tRes.error) throw new Error(`РНП WB: ${tRes.error.message}`);
    const g7 = (nm: number) => { let x = m7.get(nm); if (!x) { x = { views: 0, spent: 0, cart: 0, oc: 0, os: 0 }; m7.set(nm, x); } return x; };
    for (const f of funnelRows) {
      if (week.has(String(f.date).slice(0, 10))) { const x = g7(f.nm_id); x.cart += f.add_to_cart || 0; x.oc += f.orders || 0; x.os += Number(f.orders_sum || 0); }
    }
    for (const a of adRows) {
      const iso = String(a.date).slice(0, 10);
      spent14.set(a.nm_id, (spent14.get(a.nm_id) ?? 0) + Number(a.spent || 0));
      if (week.has(iso)) { const x = g7(a.nm_id); x.views += a.views || 0; x.spent += Number(a.spent || 0); }
    }
    for (const t of (tRes.data ?? []) as RpcTotal[]) totals.set(t.nm_id, t);
  }

  const enrich = (c: WbCard) => {
    const a = m7.get(c.nmID);
    const t = totals.get(c.nmID);
    const cost = Number(t?.cost ?? 0);
    const os = a?.os ?? 0, oc = a?.oc ?? 0, views = a?.views ?? 0, spent = a?.spent ?? 0;
    const price = oc > 0 ? os / oc : 0;
    return {
      nm: c.nmID,
      art: c.vendorCode || String(c.nmID),
      name: c.title || c.vendorCode || "",
      img_url: wbCardImageUrl(c.nmID),
      shop: c._shop || "Магазин",
      shows_7d: views,
      orders_sum_7d: Math.round(os),
      adv_spend_7d: Math.round(spent),
      adv_spend_14d: Math.round(spent14.get(c.nmID) ?? 0),
      drr_7d: os > 0 ? r1((spent / os) * 100) : (spent > 0 ? null : 0),
      margin_before_drr: price > 0 && cost > 0 ? r1(((price - cost) / price) * 100) : null,
      stock: Number(t?.stock ?? 0),
      nm_rating: ratingAgg.get(c.nmID) ? Math.round((ratingAgg.get(c.nmID)!.sum / ratingAgg.get(c.nmID)!.count) * 10) / 10 : null,
      nm_feedbacks: ratingAgg.get(c.nmID)?.count ?? null,
      signal: views === 0 && oc === 0 ? "Без трафика" : null,
    };
  };

  // 3) группировка по imtID
  const byImt = new Map<number, WbCard[]>();
  for (const c of cards) {
    if (!byImt.has(c.imtID)) byImt.set(c.imtID, []);
    byImt.get(c.imtID)!.push(c);
  }

  const toGroup = (imt: number, items: WbCard[]) => ({
    imt_id: imt,
    shop_label: items[0]?._shop || "Магазин",
    category_label: items[0]?.subjectName || "",
    valuation: null,
    feedback_count: 0,
    hide_group_rating: true,
    skus: items.map(enrich),
  });

  const groups_multi: ReturnType<typeof toGroup>[] = [];
  const groups_solo: ReturnType<typeof toGroup>[] = [];
  for (const [imt, items] of byImt) {
    const g = toGroup(imt, items);
    if (items.length > 1) groups_multi.push(g);
    else groups_solo.push(g);
  }
  groups_multi.sort((a, b) => b.skus.length - a.skus.length);

  // «Покрыто данными» = карточки, для которых реально нашлись метрики воронки/рекламы
  // или остатков — а не просто общее число карточек (иначе KPI всегда = total_sku).
  const covered = cards.filter((c) => m7.has(c.nmID) || totals.has(c.nmID)).length;

      return {
        groups_multi,
        groups_solo,
        total_sku: cards.length,
        multi_groups: groups_multi.length,
        solo_skus: groups_solo.length,
        covered,
      };
    },
    {
      forceRefresh: request.nextUrl.searchParams.get("refresh") === "1",
      backgroundRefresh: request.nextUrl.searchParams.get("background") === "1",
    },
  );
  return NextResponse.json(payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
