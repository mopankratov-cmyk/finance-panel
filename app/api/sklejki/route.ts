import { NextRequest, NextResponse } from "next/server";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCabinetSources } from "@/lib/wb/cabinetTokens";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface WbCard {
  nmID: number;
  imtID: number;
  vendorCode: string;
  title?: string;
  subjectName?: string;
  _shop?: string;
}

interface FunnelRow { nm_id: number; date: string; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; spent: number }
interface RpcTotal { nm_id: number; stock: number; cost: number | null }

const r1 = (v: number) => Math.round(v * 10) / 10;

const EMPTY = { groups_multi: [], groups_solo: [], total_sku: 0, multi_groups: 0, solo_skus: 0, covered: 0 };

// Контракт inferno: {groups_multi, groups_solo, total_sku, multi_groups, solo_skus, covered}.
// ?cabinet=<uuid|all> — карточки тянем токеном Контент каждого кабинета, тегируем кабинетом.
export async function GET(request: NextRequest) {
  const { cabinetId } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);
  const sources = await getWbCabinetSources(cabinetId, "content");
  if (!sources.length) return NextResponse.json(EMPTY);

  // 1) карточки из Content API — по каждому кабинету своим токеном, с тегом кабинета
  const cards: WbCard[] = [];
  for (const src of sources) {
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page < 10; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) break;
        const json = (await res.json()) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number } };
        const batch = json.cards ?? [];
        for (const c of batch) cards.push({ ...c, _shop: src.name });
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
    } catch {
      /* ignore */
    }
  }

  // 2) метрики воронки/рекламы по nm (7д и 14д) из синка — в разрезе кабинета
  const db = getSupabaseAdmin();
  const m7 = new Map<number, { views: number; spent: number; cart: number; oc: number; os: number }>();
  const spent14 = new Map<number, number>();
  const totals = new Map<number, RpcTotal>();
  if (db) {
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const week = new Set(
      Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)),
    );
    let fQ = db.from("wb_funnel_daily").select("nm_id, date, add_to_cart, orders, orders_sum").gte("date", since);
    let aQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, spent").gte("date", since);
    if (cabinetId) { fQ = fQ.eq("cabinet_id", cabinetId); aQ = aQ.eq("cabinet_id", cabinetId); }
    const [fRes, aRes, tRes] = await Promise.all([fQ, aQ, db.rpc("rnp_report", { p_cabinet: cabinetId })]);
    const g7 = (nm: number) => { let x = m7.get(nm); if (!x) { x = { views: 0, spent: 0, cart: 0, oc: 0, os: 0 }; m7.set(nm, x); } return x; };
    for (const f of (fRes.data ?? []) as FunnelRow[]) {
      if (week.has(String(f.date).slice(0, 10))) { const x = g7(f.nm_id); x.cart += f.add_to_cart || 0; x.oc += f.orders || 0; x.os += Number(f.orders_sum || 0); }
    }
    for (const a of (aRes.data ?? []) as AdRow[]) {
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
      nm_rating: null,
      nm_feedbacks: undefined,
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

  return NextResponse.json({
    groups_multi,
    groups_solo,
    total_sku: cards.length,
    multi_groups: groups_multi.length,
    solo_skus: groups_solo.length,
    covered: cards.length,
  });
}
