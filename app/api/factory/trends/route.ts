import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { fetchViral, hasTrendSource, trendSourceName } from "@/lib/factory/trendSources";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

interface ViralVideo { url?: string; caption?: string; title?: string; views?: number; likes?: number; transcript?: string }

// Трендоскоp: разбор залетевших Reels/Shorts/TikTok → паттерны-победители → бриф + few-shot для Копирайтера.
// videos приходят с ручного ввода/браузерного поиска/Apify (позже авто).
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const niche: string = (body.niche || "").toString().trim();
  let videos: ViralVideo[] = Array.isArray(body.videos) ? body.videos.slice(0, 30) : [];
  let source = "ручной";
  // Авто-поиск: если видео не переданы, но есть ключ-источник (Apify/Virlo) — тянем сами.
  if (!videos.length && niche && hasTrendSource()) {
    videos = await fetchViral(niche, 20);
    source = trendSourceName();
  }
  if (!videos.length) return NextResponse.json({ error: hasTrendSource() ? "Источник не вернул видео — попробуй другую нишу или вставь вручную." : "Вставь залетевшие видео вручную, либо добавь APIFY_TOKEN/VIRLO_API_KEY для авто-поиска.", patterns: null }, { status: 200 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({
    niche,
    analyzed: videos.length,
    source,
    patterns: {
      winning_hooks: [],
      formats: [],
      structure: "fallback: Claude недоступен",
      sounds: [],
      why_viral: [],
      brief: "Используй простую slideshow-структуру с быстрым хуком и мягким CTA.",
      reuse_hooks: [],
    },
    warning: "ANTHROPIC_API_KEY не настроен",
  });

  const list = videos.map((v, i) => `#${i + 1}${v.views ? ` (${v.views} просм.)` : ""}: ${(v.caption || v.title || v.url || "").toString().slice(0, 200)}${v.transcript ? ` | текст: ${v.transcript.slice(0, 300)}` : ""}`).join("\n");

  const sys = "Ты аналитик виральных коротких видео (Reels/Shorts/TikTok). Тебе дают список ЗАЛЕТЕВШИХ роликов в нише. Найди ПАТТЕРНЫ-ПОБЕДИТЕЛИ, которые повторяются у успешных. " +
    "Верни СТРОГО JSON: {\"winning_hooks\":[\"типы хуков первых 3 сек, что цепляет\"],\"formats\":[\"форматы: POV/до-после/лайфхак...\"],\"structure\":\"общая структура успешного ролика\",\"sounds\":[\"какие звуки/музыка заходят\"],\"why_viral\":[\"почему залетают — 3-5 причин\"],\"brief\":\"бриф Копирайтеру: повтори эти паттерны (1 абзац)\",\"reuse_hooks\":[\"6 готовых хуков под нишу на основе паттернов\"]}. Только JSON.";
  const user = `Ниша: ${niche || "не указана"}. Залетевшие видео:\n${list}\n\nРазбери и дай паттерны + бриф + 6 хуков под нишу.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2000, system: sys, messages: [{ role: "user", content: user }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const patterns = extractJson(txt);
    if (!patterns) return NextResponse.json({ niche, analyzed: videos.length, source, patterns: null, warning: "пустой разбор" });
    return NextResponse.json({ niche, analyzed: videos.length, source, patterns });
  } catch (e) {
    return NextResponse.json({ niche, analyzed: videos.length, source, patterns: null, warning: String(e).slice(0, 200) });
  }
  } catch (e) {
    return NextResponse.json({
      niche: "",
      analyzed: 0,
      source: "",
      patterns: null,
      error: "trends crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
