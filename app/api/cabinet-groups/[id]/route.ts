import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(["director"]);
  if (gate) return gate;
  const { id } = await ctx.params;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const { error } = await db.from("cabinet_groups").delete().eq("id", id);
  if (error) {
    console.error("[cabinet-groups] delete:", error.message);
    return NextResponse.json({ error: "Сервис групп временно недоступен" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
