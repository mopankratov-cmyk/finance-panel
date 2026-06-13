import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { generateInsights } from "@/lib/agent/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Пересобрать правиловые инсайты (полный рефреш rules-набора). Вешается на синхронизацию + кнопка.
export async function POST() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const drafts = await generateInsights();

  // полный рефреш: удаляем прошлый rules-набор, вставляем актуальный
  await db.from("agent_insights").delete().filter("data->>src", "eq", "rules");
  if (drafts.length) {
    const ins = drafts.map((d) => ({ ...d, is_read: false }));
    const { error } = await db.from("agent_insights").insert(ins);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: drafts.length, high: drafts.filter((d) => d.severity === "high").length });
}

export async function GET() {
  return POST();
}
