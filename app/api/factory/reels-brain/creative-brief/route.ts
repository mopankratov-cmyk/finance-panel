import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type Pattern = {
  pattern_id?: string;
  hook_type?: string;
  hook_label?: string;
  structure_type?: string;
  structure_label?: string;
  retention_mechanism?: string;
  retention_label?: string;
  frequency?: number;
  strength_score?: number;
  quality_label?: string;
  quality_score?: number;
  relevance_score?: number;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function score(pattern: Pattern) {
  return Math.round(Math.min(100,
    num(pattern.strength_score)
    + Math.min(20, Math.log(num(pattern.frequency) + 1) * 6)
    + (pattern.quality_label === "generator_ready" ? 12 : 0)
    + Math.min(10, num(pattern.relevance_score) / 10)
  ));
}

function brief(pattern: Pattern, niche: string, productType: string) {
  const hook = pattern.hook_label || pattern.hook_type || "сильный хук";
  const structure = pattern.structure_label || pattern.structure_type || "демонстрация";
  const retention = pattern.retention_label || pattern.retention_mechanism || "ожидание доказательства";
  return {
    source: "reels_brain_best_pattern",
    niche,
    product_type: productType || "любой товар с визуальным proof",
    pattern_id: pattern.pattern_id || `${pattern.hook_type || "hook"}:${pattern.structure_type || "format"}:${pattern.retention_mechanism || "retention"}`,
    op_score: score(pattern),
    hook: `Адаптируй механику "${hook}" под ${productType || "товар"}: покажи боль/обещание в первом кадре.`,
    retention,
    structure,
    second_by_second: [
      "0-2с: первый кадр с болью, обещанием или неожиданным proof.",
      `2-5с: раскрыть механику через ${structure}, без длинного вступления.`,
      `5-10с: удерживать через "${retention}" и показывать доказательство, а не рассказ.`,
      "10-15с: payoff/result, крупный план товара или результата.",
      "15-20с: короткий вывод + мягкий CTA.",
    ],
    visual_recipe: [
      "Вертикальный 9:16, крупный первый кадр, смысл читается без звука.",
      "Минимум пустого фона; товар/результат занимает главный фокус.",
      "Склейки каждые 0.5-1.2с, если формат динамичный.",
      "Текст на экране только для хука и proof, не декоративно.",
    ],
    copy_as_mechanic: [
      "Темп раскрытия",
      "Тип первого обещания",
      "Структуру доказательства",
      "Механику удержания",
    ],
    do_not_copy: [
      "Чужой текст/озвучку",
      "Музыку",
      "Персонажей",
      "Монтаж покадрово",
      "Недоказуемые claims",
    ],
  };
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const niche = String(req.nextUrl.searchParams.get("niche") || "ru_toys").trim();
    const productType = String(req.nextUrl.searchParams.get("product_type") || "").trim();
    const platform = String(req.nextUrl.searchParams.get("platform") || "").trim();

    const { data, error } = await db
      .from("niche_playbooks")
      .select("playbook")
      .eq("niche", niche)
      .limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const playbook = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || {}) as Record<string, unknown>;
    const brain = (playbook.reels_brain_patterns || {}) as Record<string, unknown>;
    const platformBrains = (brain.platform_brains || {}) as Record<string, { generator_ready_patterns?: Pattern[]; patterns?: Pattern[] }>;
    const platformPatterns = platform && platformBrains[platform]
      ? (platformBrains[platform].generator_ready_patterns?.length ? platformBrains[platform].generator_ready_patterns : platformBrains[platform].patterns) || []
      : [];
    const meta = (brain.meta_brain || {}) as { generator_ready_patterns?: Pattern[]; patterns?: Pattern[] };
    const patterns = platformPatterns.length ? platformPatterns : (meta.generator_ready_patterns?.length ? meta.generator_ready_patterns : meta.patterns) || [];
    const best = [...patterns].sort((a, b) => score(b) - score(a))[0];
    if (!best) return NextResponse.json({ ok: false, error: "Нет готовых паттернов для этой ниши" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      niche,
      platform: platform || null,
      creative_brief: brief(best, niche, productType),
      quality_gate: score(best) >= 85 ? "high_confidence" : score(best) >= 70 ? "medium_confidence" : "experimental",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "creative-brief reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
