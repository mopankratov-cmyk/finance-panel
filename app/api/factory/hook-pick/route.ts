import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V9 · Хук-турнир: оператор выбрал лучший из вариантов (/variations → /hook-judge → выбор).
// Это ЭКСПЕРТНЫЙ сигнал (оператор лично выбрал) — сильнее AI-судьи, слабее рыночного залёта:
//   chosen  → cf_signals event='hook_chosen' + seed viral_hooks viability=4 (тир ОТК-пасса; winners=5 рынок, AI-судья=3)
//   rejected→ cf_signals event='hook_passed' (ЛЁГКИЙ журнал — НЕ анти-паттерн: проигравшие в турнире не «плохие»,
//             просто не выбраны; не кормим их в rejectAntiFor, чтобы не глушить норм-хуки).
//   POST { recipe_id?, node_id?, chosen, rejected?:[], niche?, article? }
export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const chosen = (b.chosen || "").toString().trim().slice(0, 300);
  if (!chosen) return NextResponse.json({ ok: false, error: "нужен chosen" }, { status: 400 });
  const article = (b.article || "").toString().trim();
  const niche = (["clothing", "toys", "cosmetics", "default"].includes(b.niche) ? b.niche : nicheFromArticle(article, chosen));
  const recipe_id = typeof b.recipe_id === "number" ? b.recipe_id : null;
  const node_id = typeof b.node_id === "number" ? b.node_id : null;
  const rejected: string[] = Array.isArray(b.rejected) ? b.rejected.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 8) : [];

  // 1) сигнал выбора (журнал — что оператор предпочёл, для аналитики турнира)
  try {
    await db.from("cf_signals").insert({ event: "hook_chosen", reason_chip: chosen.slice(0, 80), recipe_id, node_id, niche, article: article || null });
  } catch { /* best-effort */ }

  // 2) seed выбранного хука в корпус (viability=4 — экспертная преференция, переживает рестарты)
  let seeded = false;
  try {
    const note = "operator tournament pick";
    const { error: ie } = await db.from("viral_hooks").insert({ niche, hook_text: chosen, viability_score: 4, effectiveness_notes: note });
    if (ie) {
      // уже есть — поднимаем до 4, но НЕ перебиваем рыночный winners=5
      await db.from("viral_hooks").update({ viability_score: 4, effectiveness_notes: note }).eq("niche", niche).eq("hook_text", chosen).lt("viability_score", 4);
    }
    seeded = true;
  } catch { /* viral_hooks опционально */ }

  // 3) лёгкий журнал проигравших (НЕ анти-паттерн — просто «видели, не выбрали»)
  if (rejected.length) {
    try {
      await db.from("cf_signals").insert(rejected.map((h) => ({ event: "hook_passed", reason_chip: h.slice(0, 80), recipe_id, node_id, niche, article: article || null })));
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, seeded, passed: rejected.length });
}
