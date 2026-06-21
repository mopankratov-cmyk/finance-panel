import { NextRequest, NextResponse } from "next/server";
import { creatifyLinkVideo, creatifyLipsync, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// UGC-актёр Creatify. Если есть товар (URL карточки WB) → link_to_videos (актёр + ПОКАЗ товара).
// Иначе → lipsyncs (актёр просто говорит текст). Async: task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  if (!creatifyReady()) return NextResponse.json({ detail: "Creatify не подключён: добавь CREATIFY_API_ID и CREATIFY_API_KEY в Vercel env" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const script: string = (body.script || body.brief || body.hook || "").toString().trim();
  const debugMode = body.debug === true;
  let url: string = (body.product_url || "").toString().trim();
  let images: string[] = Array.isArray(body.images) ? body.images : [];
  let title = "";

  // резолв фото+названия+URL карточки WB по артикулу (nm_id из rnp_report). Фото отдаём Creatify напрямую.
  if ((!images.length || !url) && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { getWbCardImage } = await import("@/lib/wb/cardImage");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) {
          if (!url) url = `https://www.wildberries.ru/catalog/${row.nm_id}/detail.aspx`;
          title = (row.name as string) || "";
          if (!images.length) { const img = await getWbCardImage(Number(row.nm_id)); if (img) images = [img]; }
        }
      }
    } catch { /* без фото — уйдём в lipsync */ }
  }

  if (images.length || url) {
    const res = await creatifyLinkVideo({ url: url || undefined, images, title: title || (body.brief || "").toString(), description: script || (body.brief || "").toString(), script: script || undefined, avatar: (body.creator || body.avatar || "").trim() || undefined, visual_style: (body.visual_style || "").toString().trim() || undefined });
    if (res.error || !res.token) return NextResponse.json({ detail: res.error || "Creatify не запустил", ...(debugMode ? { debug: res.debug } : {}) }, { status: 502 });
    return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify", mode: "link_to_videos", product_url: url, ...(debugMode ? { debug: res.debug } : {}) });
  }

  if (!script) return NextResponse.json({ detail: "Нужен товар (артикул/URL) или текст для актёра" }, { status: 400 });
  const res = await creatifyLipsync(script, { creator: (body.creator || "").trim() || undefined });
  if (res.error || !res.token) return NextResponse.json({ detail: res.error || "Creatify не запустил" }, { status: 502 });
  return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify", mode: "lipsyncs" });
}
