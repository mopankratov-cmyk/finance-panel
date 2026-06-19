import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { buildEdit, fixedBeatGrid, quantizeToBeats, type AssemblyClip } from "@/lib/factory/shotstack";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Assembly Agent (Factory v2): собирает Shotstack edit_json из РЕАЛЬНЫХ блоков библиотеки (content_assets)
// по схеме [HOOK]+[SCENE]+[PAYOFF] на фикс-бит-сетке + хук-текст + субтитры. НЕ рендерит (это compose-шаг).
// v1 — детерминированная выборка (реальные клипы по артикулу/нише, видео раньше фото); умный подбор блоков — позже.
// Ключ Shotstack тут НЕ нужен — строим только JSON; рендер пойдёт через lib/factory/shotstack отдельным шагом.
interface AssetRow { id: number; url: string | null; kind: string; role: string | null; duration_sec: number | null }

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  const hook: string = (body.hook || "").toString().trim();
  const mode: string = body.mode === "sell" ? "sell" : "audience";
  let name: string = (body.product_name || "").toString().trim();
  if (!name && article) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  const niche = nicheFromArticle(article, name);

  // блоки библиотеки: сперва по точному артикулу, иначе по нише. url обязателен.
  const cols = "id,url,kind,role,duration_sec";
  let assets: AssetRow[] = [];
  if (article) {
    const { data } = await db.from("content_assets").select(cols).eq("article", article).not("url", "is", null).limit(8);
    assets = (data as AssetRow[] | null) ?? [];
  }
  if (!assets.length) {
    const { data } = await db.from("content_assets").select(cols).eq("niche", niche).not("url", "is", null).limit(8);
    assets = (data as AssetRow[] | null) ?? [];
  }
  if (!assets.length) return NextResponse.json({ error: "нет реальных блоков для сборки (наполни библиотеку content_assets)", niche }, { status: 404 });

  // порядок: видео раньше изображений (видео = живой хребет). Берём до 4 блоков.
  const ordered = [...assets].sort((a, b) => (a.kind === "video" ? 0 : 1) - (b.kind === "video" ? 0 : 1)).slice(0, 4);
  let t = 0;
  const rawClips: AssemblyClip[] = ordered.map((a, i) => {
    const len = a.kind === "video" ? Math.min(6, Number(a.duration_sec) || 4) : 3; // image-блок ~3с
    const clip: AssemblyClip = { url: a.url as string, type: a.kind === "video" ? "video" : "image", start: t, length: len };
    if (i > 0) clip.transition = "fade";
    t += len;
    return clip;
  });
  const total = Math.max(5, t);
  const grid = fixedBeatGrid(120, total);             // фикс-сетка (бит-синк демоутнут до live-mp3)
  const clips = quantizeToBeats(rawClips, grid);
  const blockIds = ordered.map((a) => a.id);

  const caption: string = (body.caption || (article ? "Ищи на WB: " + article : "")).toString().slice(0, 120);
  const fontUrl: string | undefined = (process.env.SHOTSTACK_FONT_URL || "").trim() || undefined; // Cyrillic-TTF, иначе RU=tofu
  const edit = buildEdit({ clips, hookText: hook || undefined, caption: caption || undefined, fontUrl, aspect: "9:16" });

  return NextResponse.json({
    niche, mode,
    blocks: blockIds.length,
    block_ids: blockIds,
    beat_times: grid,
    edit_json: edit,
    font_ready: !!fontUrl, // false → добавь SHOTSTACK_FONT_URL (Cyrillic-TTF), иначе кириллица сломается
    note: "edit_json готов к рендеру через lib/factory/shotstack.shotstackSubmit (нужен SHOTSTACK_API_KEY + смоук-тест)",
  });
}
