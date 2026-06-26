import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloListMonitors, virloCreateMonitor } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R2: Инициализация Comet-мониторов по нишам.
// Сначала читает существующие мониторы (list_niche_monitors, бесплатно) — переиспользует, не создаёт дубли.
// Если для ниши нет монитора → create_niche_monitor (~$1-2 разово).
// Результат сохраняет в niche_monitors. Запускается ОДИН РАЗ вручную из кокпита.
//
// POST { niches?: ["clothing","toys","cosmetics"] }  — опционально ограничить ниши.

const NICHE_KEYWORDS: Record<string, string[]> = {
  clothing: ["детская одежда", "куртки", "ветровки", "пуховики для детей", "школьная форма"],
  toys:     ["детские игрушки", "бластеры", "водяные пистолеты", "развивающие игрушки"],
  cosmetics: ["косметика", "уход за кожей", "крем", "сыворотка", "бьюти"],
  default:  ["товары маркетплейс", "WB", "Wildberries", "Ozon"],
};

export async function POST(req: NextRequest) {
  try {
  if (!process.env.VIRLO_API_KEY) {
    return NextResponse.json({ error: "VIRLO_API_KEY не настроен" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const requestedNiches: string[] = Array.isArray(body.niches)
    ? body.niches.filter((n: unknown) => typeof n === "string" && NICHE_KEYWORDS[n])
    : Object.keys(NICHE_KEYWORDS);

  // 1. Читаем существующие мониторы из Virlo (бесплатно)
  const existing = await virloListMonitors();
  const existingByName = new Map(existing.map((m) => [m.name.toLowerCase(), m]));

  const results: { niche: string; monitor_id: string; created: boolean }[] = [];
  const errors: string[] = [];

  for (const niche of requestedNiches) {
    const expectedName = `wb-factory-${niche}`;
    const found = existingByName.get(expectedName.toLowerCase());

    if (found) {
      // Монитор уже есть — upsert в БД без создания
      try {
        await db.from("niche_monitors").upsert({
          monitor_id: found.id, niche,
          query: (NICHE_KEYWORDS[niche] || []).join(", "),
          platforms: ["tiktok", "instagram"],
          status: found.status === "active" ? "active" : "paused",
          updated_at: new Date().toISOString(),
        }, { onConflict: "monitor_id" });
      } catch { /* niche_monitors не применена */ }
      results.push({ niche, monitor_id: found.id, created: false });
      continue;
    }

    // Монитора нет — создаём ($1-2)
    const keywords = NICHE_KEYWORDS[niche] || [];
    try {
      const created = await virloCreateMonitor(niche, keywords, ["tiktok", "instagram"]);
      const id = created.id;
      if (!id) { errors.push(`${niche}: ${created.error || "Virlo не вернул monitor_id"}`); continue; }

      try {
        await db.from("niche_monitors").upsert({
          monitor_id: id, niche,
          query: keywords.join(", "),
          platforms: ["tiktok", "instagram"],
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "monitor_id" });
      } catch { /* niche_monitors не применена */ }
      results.push({ niche, monitor_id: id, created: true });
    } catch (e) {
      errors.push(`${niche}: ${String(e).slice(0, 80)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total: requestedNiches.length,
    initialized: results.length,
    created: results.filter((r) => r.created).length,
    reused: results.filter((r) => !r.created).length,
    results,
    errors: errors.length ? errors : undefined,
  });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      total: 0,
      initialized: 0,
      created: 0,
      reused: 0,
      results: [],
      errors: ["инициализация corpus-мониторов упала: " + String((e as Error)?.message || e).slice(0, 160)],
    }, { status: 500 });
  }
}
