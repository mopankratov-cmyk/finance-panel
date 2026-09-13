import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { generateInsights } from "@/lib/agent/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Пересобрать правиловые инсайты (полный рефреш rules-набора). Вешается на синхронизацию + кнопку.
export async function POST() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const drafts = await generateInsights();

  // Каждый draft несёт data.nm (см. lib/agent/rules.ts) — резолвим его в
  // cabinet_id через wb_cards, чтобы GET /api/agent/insights мог применить
  // hasCabinetAccess. Раньше ни один rules-инсайт не привязывался к
  // кабинету вовсе — все были видны любой сессии с analytics.view, включая
  // внешний seller_owner (аудит P0).
  const nmIds = [...new Set(
    drafts.map((d) => Number((d.data as { nm?: unknown })?.nm)).filter((n) => Number.isInteger(n) && n > 0),
  )];
  const cabinetByNm = new Map<number, string | null>();
  if (nmIds.length) {
    const { data: cards } = await db.from("wb_cards").select("nm_id, cabinet_id").in("nm_id", nmIds);
    for (const c of cards ?? []) cabinetByNm.set(Number(c.nm_id), c.cabinet_id ? String(c.cabinet_id) : null);
  }

  // полный рефреш: удаляем прошлый rules-набор, вставляем актуальный
  await db.from("agent_insights").delete().filter("data->>src", "eq", "rules");
  if (drafts.length) {
    const ins = drafts.map((d) => ({
      ...d,
      is_read: false,
      cabinet_id: cabinetByNm.get(Number((d.data as { nm?: unknown })?.nm)) ?? null,
    }));
    const withCabinet = await db.from("agent_insights").insert(ins);
    if (withCabinet.error?.code === "42703") {
      // Миграция 202609130001_agent_insights_cabinet_scope ещё не применена.
      const { error } = await db.from("agent_insights").insert(
        ins.map(({ cabinet_id: _cabinet_id, ...rest }) => rest),
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else if (withCabinet.error) {
      return NextResponse.json({ error: withCabinet.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, count: drafts.length, high: drafts.filter((d) => d.severity === "high").length });
}

export async function GET() {
  return POST();
}
