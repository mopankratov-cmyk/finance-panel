import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Выдача уровней доступа сотрудникам по кабинетам.
//
// Раздаёт права только директор: это управление доступом, а не настройка
// экрана. Менеджер, способный повысить себя до руководителя, — не уровень
// доступа, а его отсутствие.
export const dynamic = "force-dynamic";

const LEVELS = new Set(["manager", "lead"]);

async function requireDirector() {
  const session = await getServerSession();
  if (!session) return { error: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) };
  if (session.role !== "director") {
    return { error: NextResponse.json({ error: "Уровни доступа раздаёт только директор" }, { status: 403 }) };
  }
  return { session };
}

/** GET — все выданные уровни: экран показывает их рядом с сотрудниками. */
export async function GET() {
  const gate = await requireDirector();
  if (gate.error) return gate.error;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ access: [] });

  const { data, error } = await db.from("cabinet_access").select("user_id, cabinet_id, level, updated_at");
  // Таблицы ещё нет — экран покажет пусто, а не упадёт.
  if (error) return NextResponse.json({ access: [] });

  return NextResponse.json({
    access: (data ?? []).map((row) => ({
      userId: String(row.user_id),
      cabinetId: String(row.cabinet_id),
      level: String(row.level),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    })),
  });
}

/** POST {userId, cabinetId, level} — level null или "" снимает уровень. */
export async function POST(request: NextRequest) {
  const gate = await requireDirector();
  if (gate.error) return gate.error;

  const body = await request.json().catch(() => null) as
    { userId?: unknown; cabinetId?: unknown; level?: unknown } | null;
  const userId = String(body?.userId ?? "").trim();
  const cabinetId = String(body?.cabinetId ?? "").trim();
  const level = String(body?.level ?? "").trim();

  if (!userId || !cabinetId) {
    return NextResponse.json({ ok: false, error: "Нужны сотрудник и кабинет" }, { status: 400 });
  }
  if (level && !LEVELS.has(level)) {
    return NextResponse.json({ ok: false, error: "Уровень бывает manager или lead" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Нет доступа к базе" }, { status: 503 });

  // Пустой уровень — снять запись. Тогда снова работает глобальная роль, а не
  // «нет прав»: снятие уровня не должно молча отключать человека от работы.
  if (!level) {
    const { error } = await db.from("cabinet_access").delete().eq("user_id", userId).eq("cabinet_id", cabinetId);
    if (error) return NextResponse.json({ ok: false, error: "Не удалось снять уровень" }, { status: 502 });
    return NextResponse.json({ ok: true, level: null });
  }

  const { error } = await db.from("cabinet_access").upsert({
    user_id: userId,
    cabinet_id: cabinetId,
    level,
    updated_at: new Date().toISOString(),
    updated_by: gate.session?.email ?? null,
  }, { onConflict: "user_id,cabinet_id" });
  if (error) return NextResponse.json({ ok: false, error: "Не удалось выдать уровень" }, { status: 502 });

  return NextResponse.json({ ok: true, level });
}
