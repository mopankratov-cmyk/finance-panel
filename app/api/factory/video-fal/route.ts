import { NextRequest, NextResponse } from "next/server";
import { falVideoSubmit, FAL_VIDEO_MODELS, type FalVideoModel } from "@/lib/factory/falVideo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Премиум image-to-video (Kling/Seedance через FAL): реальное фото товара → динамичное видео 9:16.
// Preservation-first промпт держит форму/лейбл товара. Async: возвращает task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) return NextResponse.json({ detail: "FAL_KEY не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const model: FalVideoModel = (body.model in FAL_VIDEO_MODELS ? body.model : "kling") as FalVideoModel;
  const brief: string = (body.brief || body.hook || "").toString().trim();
  const motion: string = (body.motion || "").toString().trim();

  // источник фото: прямой URL или резолв по артикулу (реальный, с HEAD-пробой баскета)
  let imageUrl: string = (body.image_url || "").toString().trim();
  if (!imageUrl && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { getWbCardImage } = await import("@/lib/wb/cardImage");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) imageUrl = (await getWbCardImage(Number(row.nm_id))) || "";
      }
    } catch { /* без фото — ошибка ниже */ }
  }
  if (!imageUrl) return NextResponse.json({ detail: "Нет фото товара (передай image_url или артикул с данными)" }, { status: 400 });

  // промпт: выученный/улучшенный (body.prompt) ИЛИ дефолтный preservation-first
  const prompt = (body.prompt || "").toString().trim() ||
    `Keep the product EXACTLY as in the photo — identical shape, proportions, label, logo, colors; do NOT morph, deform, or replace it. ${motion || "Subtle cinematic camera motion: slow push-in with gentle parallax, soft studio light, the product stays centered, crisp and fully intact."}${brief ? ` Mood: ${brief}.` : ""}`;

  const token = await falVideoSubmit(model, imageUrl, prompt, { duration: body.duration === "10" ? "10" : "5" });
  if (!token) return NextResponse.json({ detail: "FAL не принял задачу (ключ/баланс/модель)" }, { status: 502 });
  return NextResponse.json({ task_id: "fv." + token, model, image_url: imageUrl, prompt_used: prompt });
}
