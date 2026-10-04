import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { loadProfiles } from "@/lib/assortment/brandProfilesStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Профили брендов (NORVIA, HEATON, CLÉRIN): аудитория, формы, сезоны, палитра.
 * Решение владельца — движок ничего в них не подставляет. Пока миграции нет,
 * отдаёт пустые черновики и persisted: false. canEdit — только у директора:
 * остальным форма показывается без кнопки сохранения.
 */
export async function GET() {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    const [result, session] = await Promise.all([loadProfiles(db), getServerSession()]);
    return NextResponse.json({ ...result, canEdit: sessionRoles(session).includes("director") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Профили не загрузились" }, { status: 500 });
  }
}
