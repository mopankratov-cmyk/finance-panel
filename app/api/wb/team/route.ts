import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { hashPassword } from "@/lib/auth/users";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Команда своей организации: главный пользователь кабинета заводит сотрудников.
//
// Раньше людей мог заводить только директор панели. Для внешнего селлера это
// означало ждать владельца ради каждого нового сотрудника — при том что
// сотрудники нужны ему в его же кабинете и никуда больше.
//
// Границы жёсткие и проверяются здесь, а не в интерфейсе:
//   • заводить может тот, у кого уровень «руководитель» хотя бы в одном
//     кабинете своей организации (директор панели — всегда);
//   • новый сотрудник попадает в ТУ ЖЕ организацию и получает роль seller:
//     повысить кого-то до директора, финансиста или менеджера панели нельзя;
//   • трогать можно только сотрудников своей организации;
//   • себя нельзя ни выключить, ни удалить — иначе кабинет останется без
//     хозяина, и вернуть доступ сможет только владелец панели.
export const dynamic = "force-dynamic";

interface Caller {
  uid: string;
  email: string;
  organizationId: string;
  isPanelDirector: boolean;
  /**
   * Кабинеты, которыми он ВПРАВЕ управлять. Организации мало: в ней бывает
   * несколько кабинетов, и руководитель одного не должен раздавать уровни в
   * соседних. Для директора панели — все кабинеты организации.
   */
  cabinetIds: string[];
}

/** Кто вправе управлять командой организации. */
async function resolveCaller(): Promise<{ caller: Caller } | { error: NextResponse }> {
  const session = await getServerSession();
  if (!session) return { error: NextResponse.json({ error: "Требуется вход" }, { status: 401 }) };

  const db = getSupabaseAdmin();
  if (!db) return { error: NextResponse.json({ error: "Нет доступа к базе" }, { status: 503 }) };

  if (session.role === "director") {
    const { data: all } = await db
      .from("wb_cabinets")
      .select("id")
      .eq("organization_id", session.organization_id ?? "");
    return {
      caller: {
        uid: session.uid,
        email: session.email,
        organizationId: session.organization_id ?? "",
        isPanelDirector: true,
        cabinetIds: (all ?? []).map((row) => String(row.id)),
      },
    };
  }

  if (!session.organization_id) {
    return { error: NextResponse.json({ error: "У вас нет организации" }, { status: 403 }) };
  }

  // Руководитель хотя бы одного кабинета своей организации.
  const { data: cabinets } = await db
    .from("wb_cabinets")
    .select("id")
    .eq("organization_id", session.organization_id);
  const cabinetIds = (cabinets ?? []).map((row) => String(row.id));
  if (!cabinetIds.length) {
    return { error: NextResponse.json({ error: "К организации не привязан ни один кабинет" }, { status: 403 }) };
  }

  const { data: levels } = await db
    .from("cabinet_access")
    .select("cabinet_id")
    .eq("user_id", session.uid)
    .eq("level", "lead")
    .in("cabinet_id", cabinetIds);

  if (!levels?.length) {
    return { error: NextResponse.json({ error: "Заводить сотрудников может админ кабинета" }, { status: 403 }) };
  }

  // Управлять можно только теми кабинетами, где он сам руководитель, и только
  // если они вообще ему доступны. Список из сессии сужает дальше: у менеджера
  // и селлера он жёсткий.
  const ledCabinets = (levels ?? []).map((row) => String(row.cabinet_id));
  const allowed = session.cabinet_ids.length
    ? ledCabinets.filter((id) => session.cabinet_ids.includes(id))
    : ledCabinets;
  if (!allowed.length) {
    return { error: NextResponse.json({ error: "Нет кабинетов, где вы админ" }, { status: 403 }) };
  }

  return {
    caller: {
      uid: session.uid,
      email: session.email,
      organizationId: session.organization_id,
      isPanelDirector: false,
      cabinetIds: allowed,
    },
  };
}

/** GET — сотрудники своей организации и их уровни по кабинетам. */
export async function GET() {
  const gate = await resolveCaller();
  if ("error" in gate) return gate.error;
  const db = getSupabaseAdmin()!;

  const { data: users } = await db
    .from("app_users")
    .select("id, email, role, is_active, created_at")
    .eq("organization_id", gate.caller.organizationId)
    .order("created_at");

  const cabinetIds = gate.caller.cabinetIds;
  const { data: cabinets } = cabinetIds.length
    ? await db.from("wb_cabinets").select("id, name").in("id", cabinetIds)
    : { data: [] as { id: string; name: string }[] };
  const { data: access } = cabinetIds.length
    ? await db.from("cabinet_access").select("user_id, cabinet_id, level").in("cabinet_id", cabinetIds)
    : { data: [] as { user_id: string; cabinet_id: string; level: string }[] };

  return NextResponse.json({
    me: gate.caller.uid,
    cabinets: (cabinets ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? "") })),
    users: (users ?? []).map((row) => ({
      id: String(row.id),
      email: String(row.email),
      role: String(row.role),
      isActive: Boolean(row.is_active),
    })),
    access: (access ?? []).map((row) => ({
      userId: String(row.user_id),
      cabinetId: String(row.cabinet_id),
      level: String(row.level),
    })),
  });
}

/**
 * POST — завести сотрудника, выдать уровень, выключить или включить.
 * {action: "create"|"level"|"toggle", ...}
 */
export async function POST(request: NextRequest) {
  const gate = await resolveCaller();
  if ("error" in gate) return gate.error;
  const db = getSupabaseAdmin()!;
  const { caller } = gate;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = String(body?.action ?? "").trim();

  /** Сотрудник должен быть из моей организации — иначе я его не вижу и не трогаю. */
  const ownUser = async (userId: string) => {
    const { data } = await db
      .from("app_users")
      .select("id, organization_id, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (!data || String(data.organization_id ?? "") !== caller.organizationId) return null;
    return data;
  };

  /** Кабинет должен принадлежать моей организации. */
  const ownCabinet = async (cabinetId: string) => {
    // Не «кабинет моей организации», а «кабинет, которым я руковожу»: иначе
    // руководитель одного кабинета раздавал бы права в соседних.
    if (!caller.cabinetIds.includes(cabinetId)) return false;
    const { data } = await db
      .from("wb_cabinets")
      .select("id")
      .eq("id", cabinetId)
      .eq("organization_id", caller.organizationId)
      .maybeSingle();
    return Boolean(data);
  };

  if (action === "create") {
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || password.length < 10) {
      return NextResponse.json({ ok: false, error: "Нужны почта и пароль не короче 10 символов" }, { status: 400 });
    }

    const { data: existing } = await db.from("app_users").select("id, organization_id").eq("email", email).maybeSingle();
    if (existing && String(existing.organization_id ?? "") !== caller.organizationId) {
      // Чужой сотрудник: не перехватываем и не сообщаем лишнего о нём.
      return NextResponse.json({ ok: false, error: "Такая почта уже занята" }, { status: 409 });
    }

    const password_hash = await hashPassword(password);
    // Кабинеты, которыми руководит сам заводящий, — иначе новый сотрудник
    // войдёт в пустую панель: доступ селлера требует и совпадения организации,
    // и наличия кабинета в списке (lib/auth/cabinetAccess.ts), а пустой список
    // означает «доступа нет». Шире собственных кабинетов не выдаём: админ
    // одного кабинета не должен заводить людей в соседние.
    const cabinetIds = [...caller.cabinetIds];
    // Роль всегда seller: заводить директоров и менеджеров панели отсюда нельзя.
    const patch = { role: "seller", cabinet_ids: cabinetIds, organization_id: caller.organizationId, password_hash, is_active: true };
    const { error } = existing
      ? await db.from("app_users").update(patch).eq("id", existing.id)
      : await db.from("app_users").insert({ email, ...patch });
    if (error) return NextResponse.json({ ok: false, error: "Не удалось сохранить сотрудника" }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  if (action === "level") {
    const userId = String(body?.userId ?? "").trim();
    const cabinetId = String(body?.cabinetId ?? "").trim();
    const level = String(body?.level ?? "").trim();
    if (level && level !== "manager" && level !== "lead") {
      return NextResponse.json({ ok: false, error: "Уровень бывает manager или lead" }, { status: 400 });
    }
    if (!(await ownUser(userId)) || !(await ownCabinet(cabinetId))) {
      return NextResponse.json({ ok: false, error: "Сотрудник или кабинет не из вашей организации" }, { status: 403 });
    }
    if (userId === caller.uid && level !== "lead") {
      // Понижать себя нельзя: кабинет останется без руководителя, и вернуть
      // права сможет только владелец панели.
      return NextResponse.json({ ok: false, error: "Нельзя понизить самого себя" }, { status: 400 });
    }

    if (!level) {
      const { error } = await db.from("cabinet_access").delete().eq("user_id", userId).eq("cabinet_id", cabinetId);
      if (error) return NextResponse.json({ ok: false, error: "Не удалось снять уровень" }, { status: 502 });
      return NextResponse.json({ ok: true, level: null });
    }
    const { error } = await db.from("cabinet_access").upsert({
      user_id: userId, cabinet_id: cabinetId, level, updated_at: new Date().toISOString(), updated_by: caller.email,
    }, { onConflict: "user_id,cabinet_id" });
    if (error) return NextResponse.json({ ok: false, error: "Не удалось выдать уровень" }, { status: 502 });
    return NextResponse.json({ ok: true, level });
  }

  if (action === "toggle") {
    const userId = String(body?.userId ?? "").trim();
    if (userId === caller.uid) {
      return NextResponse.json({ ok: false, error: "Нельзя выключить самого себя" }, { status: 400 });
    }
    const target = await ownUser(userId);
    if (!target) return NextResponse.json({ ok: false, error: "Сотрудник не из вашей организации" }, { status: 403 });
    const { error } = await db.from("app_users").update({ is_active: !target.is_active }).eq("id", userId);
    if (error) return NextResponse.json({ ok: false, error: "Не удалось изменить статус" }, { status: 502 });
    return NextResponse.json({ ok: true, isActive: !target.is_active });
  }

  return NextResponse.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
}
