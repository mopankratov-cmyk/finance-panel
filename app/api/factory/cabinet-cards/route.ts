import { NextRequest, NextResponse } from "next/server";
import { getWbCabinetSources } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

interface Characteristic { id?: number; name?: string; value?: string | string[] }
interface WbCard { nmID: number; vendorCode: string; title?: string; subjectName?: string; characteristics?: Characteristic[] }

function colorOf(c: WbCard): string {
  const ch = (c.characteristics || []).find((x) => /цвет/i.test(x.name || ""));
  if (!ch) return "";
  return Array.isArray(ch.value) ? ch.value.join(", ") : String(ch.value || "");
}

// Карточки кабинета через Content API: article(vendorCode) + nm_id + name + цвет + ниша(subject).
// GET ?cabinet=<uuid> (обязательно для конкретного кабинета, напр. Retail Family = куртки NORVIA).
export async function GET(req: NextRequest) {
  const cabinet = new URL(req.url).searchParams.get("cabinet") || undefined;
  const sources = await getWbCabinetSources(cabinet ?? null, "content");
  if (!sources.length) return NextResponse.json({ error: "нет content-токена кабинета" }, { status: 404 });

  const cards: { article: string; nm_id: number; name: string; color: string; subject: string; shop: string }[] = [];
  for (const src of sources) {
    let cursor: { updatedAt?: string; nmID?: number } = {};
    try {
      for (let page = 0; page < 20; page++) {
        const res = await fetch(CARDS_URL, {
          method: "POST",
          headers: { Authorization: src.token, "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
          cache: "no-store",
        });
        if (!res.ok) break;
        const json = (await res.json()) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number; total?: number } };
        const batch = json.cards ?? [];
        for (const c of batch) cards.push({ article: c.vendorCode || String(c.nmID), nm_id: c.nmID, name: c.title || "", color: colorOf(c), subject: c.subjectName || "", shop: src.name });
        if (batch.length < 100) break;
        cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
      }
    } catch { /* пропускаем кабинет при ошибке */ }
  }
  return NextResponse.json({ cabinet: cabinet ?? "all", count: cards.length, cards });
}
