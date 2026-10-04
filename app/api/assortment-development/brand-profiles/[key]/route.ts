import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { defaultProfile, parseProfileInput, type ProfileInput } from "@/lib/assortment/brandProfiles";
import { ProfileConflictError, ProfileTableMissingError, saveProfile } from "@/lib/assortment/brandProfilesStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/**
 * Сохранить профиль бренда. Профиль — решение владельца, поэтому правит только
 * директор; читают все роли модуля (GET /brand-profiles). Версия обязательна.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  // Круг модуля — как у всех роутов; правка профиля уже круга: это решение владельца.
  const session = await getServerSession();
  if (!sessionRoles(session).includes("director")) return NextResponse.json({ error: "Профиль бренда правит директор" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { key } = await ctx.params;
  const base = defaultProfile(key);
  if (!base) return NextResponse.json({ error: "Бренд не найден" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as ProfileInput | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
  const parsed = parseProfileInput(base.direction, body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    const profile = await saveProfile(db, key, parsed.patch, who);
    await audit(request, session, { action: "assortment.update", subject: `brand-profile:${key}`, after: { status: profile.status, version: profile.version, fit: profile.fitForms.length, avoid: profile.avoidForms.length, seasons: profile.seasons.length } });
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof ProfileConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof ProfileTableMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Профиль не сохранился" }, { status: 500 });
  }
}
