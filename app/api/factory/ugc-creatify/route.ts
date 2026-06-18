import { NextRequest, NextResponse } from "next/server";
import { creatifyCreate, creatifyReady } from "@/lib/factory/creatify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// UGC-актёр Creatify: URL товара (+ наш сценарий) → реалистичное UGC-видео. Async: возвращает task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  if (!creatifyReady()) return NextResponse.json({ detail: "Creatify не подключён: добавь CREATIFY_API_ID и CREATIFY_API_KEY в Vercel env" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  let url: string = (body.product_url || "").toString().trim();
  const script: string = (body.script || "").toString().trim();
  const brief: string = (body.brief || body.hook || "").toString().trim();

  // резолв URL карточки WB по артикулу (nm_id из rnp_report)
  if (!url && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) url = `https://www.wildberries.ru/catalog/${row.nm_id}/detail.aspx`;
      }
    } catch { /* без URL — ошибка ниже */ }
  }
  if (!url) return NextResponse.json({ detail: "Нужен product_url или артикул с nm_id" }, { status: 400 });

  const res = await creatifyCreate(url, { script: script || undefined, length: body.duration === 10 ? 10 : 15, name: brief });
  if (res.error || !res.token) return NextResponse.json({ detail: res.error || "Creatify не запустил" }, { status: 502 });
  return NextResponse.json({ task_id: "cf." + res.token, engine: "creatify", product_url: url });
}
