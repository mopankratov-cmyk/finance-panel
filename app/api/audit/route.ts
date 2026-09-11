import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { rolesCan } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * Чтение журнала действий.
 *
 * Право `audit.view` есть только у руководителя и финансового директора: это
 * история чужих поступков, и открывать её каждому — отдельное решение,
 * которого ТЗ не принимало.
 *
 * Роут только читает. Записи не удаляются и не правятся вовсе — ни отсюда,
 * ни откуда-либо ещё: у приложения нет таких прав в базе (миграция
 * 202609100003).
 */

const PAGE = 100;

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  if (!rolesCan(sessionRoles(session), "audit.view")) {
    return NextResponse.json({ error: "Журнал доступен руководителю и финансовому директору" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const sp = request.nextUrl.searchParams;
  const page = Math.max(0, Number(sp.get("page") ?? 0) || 0);
  const action = (sp.get("action") ?? "").trim();
  const actor = (sp.get("actor") ?? "").trim();
  const subject = (sp.get("subject") ?? "").trim();
  const from = (sp.get("from") ?? "").trim();
  const to = (sp.get("to") ?? "").trim();

  let query = db
    .from("access_audit_log")
    .select("id, created_at, actor_email, actor_roles, action, subject, before_data, after_data, ip, cabinet_id, entity_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);

  // Фильтр по действию — точным совпадением метки, а не поиском по подстроке:
  // «user.update» не должен вытаскивать «user.update.scope», если тот заведётся.
  if (action) query = query.eq("action", action);
  if (actor) query = query.ilike("actor_email", `%${actor}%`);
  if (subject) query = query.ilike("subject", `%${subject}%`);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) {
    // Пока миграция не применена, экран должен сказать это словами, а не
    // показать пустой список: пустой журнал и отсутствующий журнал — разное.
    const missing = error.code === "42P01" || /access_audit_log/.test(error.message);
    return NextResponse.json(
      { error: missing ? "Журнал ещё не заведён в базе: не применена миграция 202609100002" : error.message },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE,
  });
}
