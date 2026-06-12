import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_CONTENT_TOKEN = process.env.WB_TOKEN_CONTENT;
const CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

export interface ContentCard {
  nmId: number;
  imtId: number;
  article: string;
  brand: string;
  title: string;
  description: string;
  subjectName: string;
  photoCount: number;
  titleLen: number;
  descLen: number;
}

interface WbCard {
  nmID: number;
  imtID: number;
  vendorCode: string;
  brand?: string;
  title?: string;
  description?: string;
  subjectName?: string;
  photos?: unknown[];
}

export async function GET() {
  if (!WB_CONTENT_TOKEN) {
    return NextResponse.json({ data: null, error: "WB_TOKEN_CONTENT не настроен" }, { status: 500 });
  }
  const cards: ContentCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};
  try {
    for (let page = 0; page < 10; page++) {
      const body = {
        settings: {
          cursor: { limit: 100, ...cursor },
          filter: { withPhoto: -1 },
        },
      };
      const res = await fetch(CARDS_URL, {
        method: "POST",
        headers: { Authorization: WB_CONTENT_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ data: null, error: `WB ${res.status}: ${text.slice(0, 150)}` }, { status: 502 });
      }
      const json = (await res.json()) as { cards?: WbCard[]; cursor?: { updatedAt?: string; nmID?: number; total?: number } };
      const batch = json.cards ?? [];
      for (const c of batch) {
        cards.push({
          nmId: c.nmID,
          imtId: c.imtID,
          article: c.vendorCode ?? "",
          brand: c.brand ?? "",
          title: c.title ?? "",
          description: c.description ?? "",
          subjectName: c.subjectName ?? "",
          photoCount: (c.photos ?? []).length,
          titleLen: (c.title ?? "").length,
          descLen: (c.description ?? "").length,
        });
      }
      const total = json.cursor?.total ?? 0;
      if (batch.length < 100 || total < 100) break;
      cursor = { updatedAt: json.cursor?.updatedAt, nmID: json.cursor?.nmID };
    }
    return NextResponse.json({ data: cards, error: null });
  } catch (err) {
    return NextResponse.json({ data: null, error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
