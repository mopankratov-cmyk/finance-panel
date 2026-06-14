import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HG_BASE = "https://api.heygen.com";

// AI-аватар: Claude пишет разговорный скрипт из брифа, HeyGen генерит говорящего блогера-актёра.
export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ detail: "HEYGEN_API_KEY не настроен — вставь ключ в env Vercel, маршрут заработает сразу" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  // дефолты: Abigail (expressive) + Anya (женский русский). Переопределяются через env или body.
  const avatarId = process.env.HEYGEN_AVATAR_ID || body.avatar_id || "Abigail_expressive_2024112501";
  const voiceId = process.env.HEYGEN_VOICE_ID || body.voice_id || "37832e32d4f7475ab7a1cb0db8e5dd66";
  const brief: string = body.brief || body.hook || "";
  const readyScript: string = (body.script || "").trim();
  if (!brief && !readyScript) return NextResponse.json({ detail: "Нужен brief/hook идеи или готовый script" }, { status: 400 });

  // 1) разговорный скрипт через Claude (живой UGC-тон, 12-20 сек) — или берём готовый сценарий
  let title = "UGC-аватар";
  let spoken = readyScript || brief;
  try {
    if (readyScript) throw new Error("skip-llm"); // готовый сценарий — Claude не нужен
    const client = await createClaudeClient();
    if (client) {
      const res = await client.messages.create({
        model: MODEL, max_tokens: 350,
        system: "Ты пишешь короткий разговорный монолог для говорящего UGC-блогера (12-20 секунд, ~45-65 слов). Живой русский, как настоящий человек рассказывает подруге. Хук в первой фразе, мягкий CTA в конце (искать на WB). Верни СТРОГО JSON: {\"title\":\"...\",\"spoken\":\"текст монолога без ремарок\"}. Без преамбулы.",
        messages: [{ role: "user", content: `Товар: ${body.sku_name || body.sku_art || "товар"}${body.category ? `. Категория: ${body.category}` : ""}. Идея/хук: ${brief}. Напиши монолог для аватара.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); title = j.title || title; spoken = j.spoken || spoken; }
    }
  } catch { /* дефолт = brief */ }

  // 2) HeyGen v2/video/generate — вертикаль 9:16
  try {
    const r = await fetch(`${HG_BASE}/v2/video/generate`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        title,
        dimension: { width: 720, height: 1280 },
        video_inputs: [{
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: spoken, voice_id: voiceId },
        }],
      }),
    });
    if (!r.ok) return NextResponse.json({ detail: `HeyGen ${r.status}: ${(await r.text()).slice(0, 180)}` }, { status: 502 });
    const j = (await r.json()) as { data?: { video_id?: string }; error?: unknown };
    const videoId = j.data?.video_id;
    if (!videoId) return NextResponse.json({ detail: `HeyGen без video_id: ${JSON.stringify(j).slice(0, 150)}` }, { status: 502 });
    // stateless: video_id зашит в task_id (serverless-инстансы не делят память)
    const taskId = "av." + Buffer.from(videoId).toString("base64url");
    return NextResponse.json({ task_id: taskId, video_id: videoId, title, spoken });
  } catch (e) {
    return NextResponse.json({ detail: String(e).slice(0, 120) }, { status: 502 });
  }
}
