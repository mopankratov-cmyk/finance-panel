import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { analyzeScenarioQuality } from "@/lib/factory/scenarioQuality";
import { extractJson } from "@/lib/factory/extractJson";
import { tastePatternHints } from "@/lib/factory/tastePatterns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function fallbackRewrite(input: { scenario: string; product_name: string; issues: string[]; rewrite_hints: string[] }) {
  const basis = input.scenario.trim();
  const prefix = input.product_name ? `${input.product_name}: ` : "";
  const hint = input.rewrite_hints[0] || "сделай первый кадр более конкретным";
  const cleaned = basis
    .replace(/привет[^.?!]*/gi, "")
    .replace(/сегодня расскажу[^.?!]*/gi, "")
    .replace(/представляем[^.?!]*/gi, "")
    .replace(/\bэто не просто\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const core = cleaned || "Сначала покажи конкретную бытовую боль, потом быстрое решение";
  return {
    rewritten: `${prefix}${core}${core.endsWith(".") ? "" : "."} ${hint}.`,
    changed: cleaned !== basis,
    kept: cleaned ? [cleaned.slice(0, 140)] : [],
    score_before: 4,
    score_after: 6,
    notes: input.issues.length ? input.issues : ["fallback rewrite без Claude"],
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const scenario = str(body.scenario || body.text || body.script);
  const product_name = str(body.product_name);
  const article = str(body.article);
  const brand = str(body.brand);
  const issues = Array.isArray(body.issues) ? body.issues.map((x: unknown) => str(x)).filter(Boolean) : [];
  const rewrite_hints = Array.isArray(body.rewrite_hints) ? body.rewrite_hints.map((x: unknown) => str(x)).filter(Boolean) : [];
  const threshold = Number(body.threshold) || 7;

  if (!scenario) {
    return NextResponse.json({ error: "Нужен сценарий для переписывания" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const baseQuality = await analyzeScenarioQuality({ article, product_name, niche: str(body.niche), scenario, threshold });
  const patternHints = tastePatternHints({ niche: str(body.niche), goal: "sell", limit: 2 });
  const client = await createClaudeClient();
  if (!client) {
    return NextResponse.json({ ...fallbackRewrite({ scenario, product_name: product_name || brand, issues, rewrite_hints: [...rewrite_hints, ...patternHints] }), quality_before: baseQuality, quality_after: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const system = [
    "Ты переписываешь слабый сценарий до рендера в живой UGC-тон.",
    "Сохрани смысл и продукт, но убери стерильность, рекламу и пустую обобщённость.",
    "Добавь конкретные действия, бытовые детали, ощущения и причину досмотреть.",
    "Не делай рекламную простыню и не переусердствуй с красивостью.",
    "Верни СТРОГО JSON: {\"rewritten\":\"...\",\"changed\":true|false,\"kept\":[\"...\"],\"score_before\":1-10,\"score_after\":1-10,\"notes\":[\"...\"]}. Только JSON.",
  ].join("\n");

  const user = JSON.stringify({
    article,
    product_name,
    brand,
    scenario,
    issues,
    rewrite_hints: [...rewrite_hints, ...patternHints],
    quality_before: baseQuality,
  }, null, 2);

  try {
    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const parsed = extractJson(text);
    if (!parsed) throw new Error("невалидный JSON rewrite");
    return NextResponse.json({
      rewritten: str(parsed.rewritten || scenario),
      changed: Boolean(parsed.changed),
      kept: Array.isArray(parsed.kept) ? parsed.kept.map((x: unknown) => str(x)).filter(Boolean) : [],
      score_before: Number(parsed.score_before || baseQuality.score || 0),
      score_after: Number(parsed.score_after || baseQuality.score || 0),
      notes: Array.isArray(parsed.notes) ? parsed.notes.map((x: unknown) => str(x)).filter(Boolean) : [],
      quality_before: baseQuality,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const fallback = fallbackRewrite({ scenario, product_name: product_name || brand, issues, rewrite_hints: [...rewrite_hints, ...patternHints] });
    return NextResponse.json({
      ...fallback,
      quality_before: baseQuality,
      quality_after: null,
      error: String(error).slice(0, 180),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
