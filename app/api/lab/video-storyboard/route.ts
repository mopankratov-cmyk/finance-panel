import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { newVideoId, putVideo } from "@/lib/lab/videoStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HF_BASE = "https://platform.higgsfield.ai";
const VIDEO_SUBMIT = `${HF_BASE}/v1/image2video/dop`;

// Видео-сториборд: Claude сочиняет сценарий (заголовок/биты/моушн), Higgsfield анимирует фото товара.
export async function POST(req: NextRequest) {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) return NextResponse.json({ detail: "HF_CREDENTIALS не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const origin = new URL(req.url).origin;
  const abs = (u: string) => (u?.startsWith("/") ? origin + u : u);
  let baseImage = abs(body.sku_img_url || (body.product_urls?.[0]) || (body.ready_frame_urls?.[0]) || "");
  // если фото не передали, но есть артикул — берём фото карточки WB по nm
  if (!baseImage && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { wbCardImageUrl } = await import("@/lib/wb/cardImage");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) baseImage = wbCardImageUrl(Number(row.nm_id));
      }
    } catch { /* без фото — ошибка ниже */ }
  }
  if (!baseImage) return NextResponse.json({ detail: "Нет исходного фото товара (передай sku_img_url или артикул с данными)" }, { status: 400 });

  // 1) сценарий через Claude
  let scenario = { title: "Карточка-видео", beats: ["Показ товара", "Деталь", "Призыв"], script: "", motion: "slow cinematic push-in, keep product centered and intact, soft studio light" };
  try {
    const client = await createClaudeClient();
    if (client) {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 400,
        system: "Ты режиссёр коротких рекламных видео для карточек маркетплейса. Верни СТРОГО JSON: {\"title\":\"...\",\"beats\":[\"...\",\"...\",\"...\"],\"script\":\"короткий сценарий 2-3 предложения на русском\",\"motion\":\"one English image-to-video motion prompt: subtle camera motion, keep product intact\"}. Без преамбулы.",
        messages: [{ role: "user", content: `Товар: ${body.sku_name || body.sku_art || "товар"}${body.brief ? `. Бриф: ${body.brief}` : ""}${body.category ? `. Категория: ${body.category}` : ""}. Сделай сценарий короткого видео для карточки.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); scenario = { title: j.title || scenario.title, beats: Array.isArray(j.beats) ? j.beats : scenario.beats, script: j.script || "", motion: j.motion || scenario.motion }; }
    }
  } catch { /* дефолтный сценарий */ }

  // 2) Higgsfield image-to-video
  try {
    const sub = await fetch(VIDEO_SUBMIT, {
      method: "POST", headers: { Authorization: `Key ${credentials}`, "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ params: { prompt: scenario.motion, input_images: [{ type: "image_url", image_url: baseImage }], quality: "720p" } }),
      signal: AbortSignal.timeout(25000),
    });
    if (!sub.ok) return NextResponse.json({ detail: `Higgsfield ${sub.status}: ${(await sub.text()).slice(0, 150)}` }, { status: 502 });
    const j = (await sub.json()) as { id?: string };
    if (!j.id) return NextResponse.json({ detail: "Higgsfield не вернул id" }, { status: 502 });
    // stateless: hfJobId зашит в task_id (serverless-инстансы не делят память); стор — best-effort для recover/last
    const taskId = "hf." + Buffer.from(j.id).toString("base64url");
    putVideo(taskId, { hfJobId: j.id, scenario_title: scenario.title, beats: scenario.beats, script: scenario.script, baseImage, createdAt: Date.now() });
    return NextResponse.json({ task_id: taskId, scenario_title: scenario.title, beats: scenario.beats, script: scenario.script });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 120) }, { status: 502 });
  }
}
