import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";
import { DEAI_FILTERS } from "@/lib/factory/standard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HG_BASE = "https://api.heygen.com";

// AI-аватар: Claude пишет разговорный скрипт из брифа, HeyGen генерит говорящего блогера-актёра.
export async function POST(req: NextRequest) {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return NextResponse.json({ detail: "HEYGEN_API_KEY не настроен — вставь ключ в env Vercel, маршрут заработает сразу" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  // Курируемый пул «лицо + русский голос» (гендерно-согласованы) — для вариативности UGC.
  const POOL: { a: string; v: string }[] = [
    { a: "Abigail_expressive_2024112501", v: "37832e32d4f7475ab7a1cb0db8e5dd66" }, // Abigail + Anya (ж)
    { a: "Aiko_public", v: "aa28b796ef284c5a80497034afe9d93e" },                  // Aiko + Nadia (ж)
    { a: "Adriana_BizTalk_Front_public", v: "bc69c9589d6747028dc5ec4aec2b43c3" }, // Adriana + Dariya (ж)
    { a: "Aditya_public_2", v: "c458964dc4264b70a867b2ebcf36b51e" },              // Aditya + Andrei (м)
    { a: "Adrian_public_3_20240312", v: "ba1544b5eae84eae9cb92598f078b6b0" },     // Adrian + Oleg (м)
  ];
  const brief: string = body.brief || body.hook || "";
  // выбор: env (фикс) > body > ротация по пулу (seed = индекс идеи или хэш брифа)
  const seedSrc = body.seed != null ? String(body.seed) : (brief || "");
  let seed = 0; for (let i = 0; i < seedSrc.length; i++) seed = (seed * 31 + seedSrc.charCodeAt(i)) >>> 0;
  const pick = POOL[seed % POOL.length];
  const avatarId = process.env.HEYGEN_AVATAR_ID || body.avatar_id || pick.a;
  const voiceId = process.env.HEYGEN_VOICE_ID || body.voice_id || pick.v;
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
        system: "Ты пишешь короткий разговорный монолог для говорящего UGC-блогера (12-20 секунд, ~45-65 слов). Живой русский, как настоящий человек рассказывает подруге. Хук в первой фразе, мягкий CTA в конце (искать на WB). " + DEAI_FILTERS + " Верни СТРОГО JSON: {\"title\":\"...\",\"spoken\":\"текст монолога без ремарок\"}. Без преамбулы.",
        messages: [{ role: "user", content: `Товар: ${body.sku_name || body.sku_art || "товар"}${body.category ? `. Категория: ${body.category}` : ""}. Идея/хук: ${brief}. Напиши монолог для аватара.` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); title = j.title || title; spoken = j.spoken || spoken; }
    }
  } catch { /* дефолт = brief */ }

  // 2) HeyGen v2/video/generate — вертикаль 9:16 (1 ретрай при транзиентном сбое)
  const reqBody = JSON.stringify({
    title,
    dimension: { width: 720, height: 1280 },
    video_inputs: [{
      character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
      voice: { type: "text", input_text: spoken, voice_id: voiceId },
    }],
  });
  try {
    let r: Response | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((res) => setTimeout(res, 1500));
      try {
        r = await fetch(`${HG_BASE}/v2/video/generate`, {
          method: "POST", headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
          cache: "no-store", signal: AbortSignal.timeout(25000), body: reqBody,
        });
        if (r.ok || (r.status >= 400 && r.status < 500)) break; // успех или явная ошибка запроса — не ретраим
        lastErr = `HeyGen ${r.status}`;
      } catch (e) { lastErr = String(e).slice(0, 80); r = null; }
    }
    if (!r) return NextResponse.json({ detail: `HeyGen недоступен: ${lastErr}` }, { status: 502 });
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
