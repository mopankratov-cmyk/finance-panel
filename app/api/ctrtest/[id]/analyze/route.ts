import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { CLAUDE_MODEL, createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const migrationMissing = (code?: string) => ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code ?? "");

interface VariantRow {
  id: number;
  label: string;
  image_url: string;
  impressions: number | null;
  clicks: number | null;
  carts: number | null;
  orders: number | null;
  is_baseline: boolean | null;
}

interface AnalysisResult {
  variants: { variantId: number; verdict: string }[];
  recommendations: string[];
}

/**
 * Фаза D методологии CTR-тестов (ТЗ владельца 15.09.2026): почему обложка
 * получила такой CTR, какой получила, и что доработать в следующей.
 *
 * Vision-по-URL без скачивания и извлечение JSON из текстового ответа —
 * тот же приём, что уже отработан на живых данных в
 * app/api/lab/competitors/route.ts: строгий JSON проще извлечь регэкспом из
 * текста, чем городить отдельный structured-output контракт ради одного
 * нового роута.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return fail("Некорректный id теста", 400);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const { data: test, error } = await db
    .from("ctr_tests")
    .select("id, cabinet_id, nm_id, article, name, test_type")
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(migrationMissing(error.code) ? "Примените миграцию 20260713_ctr_test_lifecycle.sql" : error.message, migrationMissing(error.code) ? 503 : 500);
  if (!test?.cabinet_id) return fail("Тест не найден", 404);
  if (!(await hasCabinetAccess(String(test.cabinet_id)))) return fail("Нет доступа к кабинету", 403);
  if (test.test_type !== "ctr") return fail("ИИ-разбор фото пока доступен только для CTR-тестов", 400);

  const { data: variantRows, error: variantsError } = await db
    .from("ctr_variants")
    .select("id, label, image_url, impressions, clicks, carts, orders, is_baseline")
    .eq("test_id", id)
    .order("position", { ascending: true });
  if (variantsError) return fail(variantsError.message, 500);
  const variants = (variantRows ?? []) as VariantRow[];
  const withData = variants.filter((variant) => Number(variant.impressions ?? 0) > 0 && variant.image_url);
  if (withData.length < 2) return fail("Разбирать пока нечего: у теста меньше двух вариантов с реальными показами", 400);

  const client = await createClaudeClient();
  if (!client) return fail("ANTHROPIC_API_KEY не настроен", 503);

  const metricLine = (variant: VariantRow) => {
    const impressions = Number(variant.impressions ?? 0);
    const clicks = Number(variant.clicks ?? 0);
    const ctr = impressions > 0 ? (clicks / impressions * 100).toFixed(2) : "—";
    return `Вариант ${variant.id} «${variant.label}»${variant.is_baseline ? " (была на карточке до теста)" : ""}: ${impressions} показов, ${clicks} кликов, CTR ${ctr}%, корзин ${Number(variant.carts ?? 0)}, заказов ${Number(variant.orders ?? 0)}.`;
  };

  const parts: ({ type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } })[] = [
    {
      type: "text",
      text: `Артикул ${test.article ?? test.nm_id}. Ниже — обложки-варианты CTR-теста и их реальные метрики WB за период измерения:\n${withData.map(metricLine).join("\n")}\n\nПо каждой картинке ниже (в том же порядке, что метрики) дай вердикт: почему у неё такой CTR — что в композиции/ракурсе/тексте/фоне сработало или помешало кликабельности в выдаче WB. Смотри именно на разницу между вариантами, а не описывай каждое фото само по себе.`,
    },
  ];
  for (const variant of withData) parts.push({ type: "image", source: { type: "url", url: variant.image_url } });
  parts.push({
    type: "text",
    text: `Верни СТРОГО JSON без преамбулы: {"variants":[{"variantId":число,"verdict":"вердикт по этому варианту на русском, 1-2 предложения"}],"recommendations":["конкретная рекомендация по доработке будущих обложек, на русском"]}. Порядок variantId ровно такой: ${withData.map((v) => v.id).join(", ")}.`,
  });

  let analysis: AnalysisResult;
  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: "Ты — эксперт по CTR обложек товаров на маркетплейсах (Wildberries). Анализируешь, почему один вариант обложки кликают чаще другого, и даёшь конкретные, применимые советы по доработке — не общие фразы вроде «сделайте фото качественнее». Отвечаешь только JSON.",
      messages: [{ role: "user", content: parts as never }],
    });
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join(" ");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fail("Claude не вернул разбор в ожидаемом формате", 502);
    const parsed = JSON.parse(match[0]) as Partial<AnalysisResult>;
    const knownIds = new Set(withData.map((v) => v.id));
    analysis = {
      variants: (parsed.variants ?? []).filter((v) => knownIds.has(Number(v.variantId))).map((v) => ({ variantId: Number(v.variantId), verdict: String(v.verdict ?? "").slice(0, 1000) })),
      recommendations: (parsed.recommendations ?? []).map((r) => String(r).slice(0, 500)).slice(0, 10),
    };
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message.slice(0, 300) : "Разбор не удался", 502);
  }

  const generatedAt = new Date().toISOString();
  const { error: saveError } = await db
    .from("ctr_tests")
    .update({ ai_analysis: analysis, ai_analysis_generated_at: generatedAt, updated_at: generatedAt })
    .eq("id", id);
  if (saveError) return fail(migrationMissing(saveError.code) ? "Примените миграцию 202609150005_ctr_test_ai_analysis.sql" : saveError.message, migrationMissing(saveError.code) ? 503 : 500);

  return NextResponse.json({ data: { analysis, generatedAt }, error: null });
}
