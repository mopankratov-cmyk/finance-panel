import { NextResponse } from "next/server";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_CONTENT_TOKEN = process.env.WB_TOKEN_CONTENT;
const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface WbCard {
  nmID: number;
  imtID: number;
  vendorCode: string;
  title?: string;
}

// Контракт inferno: {groups_multi, groups_solo, total_sku, multi_groups, solo_skus, covered}
export async function GET() {
  if (!WB_CONTENT_TOKEN) return NextResponse.json({ groups_multi: [], groups_solo: [], total_sku: 0, multi_groups: 0, solo_skus: 0, covered: 0 });

  const cards: WbCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};
  try {
    for (let page = 0; page < 10; page++) {
      const res = await fetch(CARDS_URL, {
        method: "POST",
        headers: { Authorization: WB_CONTENT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
        cache: "no-store",
      });
      if (!res.ok) break;
      const json = (await res.json()) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number; total?: number } };
      const batch = json.cards ?? [];
      cards.push(...batch);
      if (batch.length < 100) break;
      cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
    }
  } catch {
    /* ignore */
  }

  const byImt = new Map<number, WbCard[]>();
  for (const c of cards) {
    if (!byImt.has(c.imtID)) byImt.set(c.imtID, []);
    byImt.get(c.imtID)!.push(c);
  }

  const toItem = (c: WbCard) => ({
    nm: c.nmID,
    art: c.vendorCode || String(c.nmID),
    name: c.title || c.vendorCode || "",
    img_url: wbCardImageUrl(c.nmID),
    rating: null,
    feedbacks: null,
    metrics: [],
  });
  const toGroup = (imt: number, items: WbCard[]) => ({ imt, count: items.length, items: items.map(toItem) });

  const groups_multi: ReturnType<typeof toGroup>[] = [];
  const groups_solo: ReturnType<typeof toGroup>[] = [];
  for (const [imt, items] of byImt) {
    const g = toGroup(imt, items);
    if (items.length > 1) groups_multi.push(g);
    else groups_solo.push(g);
  }
  groups_multi.sort((a, b) => b.count - a.count);

  return NextResponse.json({
    groups_multi,
    groups_solo,
    total_sku: cards.length,
    multi_groups: groups_multi.length,
    solo_skus: groups_solo.length,
    covered: cards.length,
  });
}
