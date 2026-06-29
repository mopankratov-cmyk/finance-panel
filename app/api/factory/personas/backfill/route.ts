import { NextRequest, NextResponse } from "next/server";
import { creatifyListAvatars, creatifyReady } from "@/lib/factory/creatify";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    if (!creatifyReady()) return NextResponse.json({ ok: false, error: "Creatify не подключён" }, { status: 503 });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const dryRun = body.dry_run === true;
    const limit = Math.min(400, Math.max(12, Number(body.limit) || 120));
    const warnings: string[] = [];

    const avatars = await creatifyListAvatars({ limit });
    if (avatars.error) warnings.push(avatars.error);
    const now = new Date().toISOString();
    const rows = avatars.avatars.map((avatar) => ({
      name: avatar.name || "Creatify stock avatar",
      provider: "creatify",
      provider_persona_id: avatar.id,
      avatar_url: avatar.thumb || avatar.video || null,
      consent_status: "stock",
      consent_source: "platform_stock",
      consent_checked_at: now,
      locale: "ru-RU",
      metadata: {
        source: "creatify_personas_backfill",
        gender: avatar.gender || null,
        age: avatar.age || null,
        style: avatar.style || null,
        location: avatar.location || null,
        scene: avatar.scene || null,
        industries: avatar.industries || null,
        preview_video: avatar.video || null,
      },
      updated_at: now,
    }));

    if (dryRun) {
      return NextResponse.json({ ok: true, dry_run: true, count: rows.length, warnings, sample: rows.slice(0, 5) });
    }
    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "Creatify не вернул personas для backfill", warnings }, { status: avatars.error ? 502 : 404 });
    }

    const saved = await db.from("factory_personas")
      .upsert(rows, { onConflict: "provider,provider_persona_id" })
      .select("id")
      .limit(rows.length);
    if (saved?.error) {
      return NextResponse.json({ ok: false, error: "factory_personas upsert: " + saved.error.message.slice(0, 180), warnings }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      provider: "creatify",
      consent_status: "stock",
      consent_source: "platform_stock",
      count: rows.length,
      saved: ((saved?.data as unknown[] | null) || []).length,
      warnings,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "personas backfill crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
