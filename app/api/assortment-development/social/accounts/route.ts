import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { parseAccountKind, parseHandle } from "@/lib/assortment/socialFeed";
import { addSocialAccount, loadSocialAccountsView, setSocialAccountStatus, SOCIAL_UNAVAILABLE } from "@/lib/assortment/socialFeedStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Аккаунты-источники «Залетает» (публичные аккаунты стилистов, байеров, перепродавцов и брендов — владелец разрешил хранить их как
 * источники). Читают все роли модуля; исключить, вернуть и добавить по нику — только директор (как профили брендов): canEdit в ответе,
 * у остальных кнопок нет.
 */
export async function GET() {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  try {
    const [result, session] = await Promise.all([loadSocialAccountsView(db), getServerSession()]);
    const canEdit = sessionRoles(session).includes("director");
    if (!result) return NextResponse.json({ available: false, reason: SOCIAL_UNAVAILABLE, canEdit: false }, { headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json({ available: true, ...result, canEdit }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Аккаунты не загрузились" }, { status: 500 });
  }
}

async function directorOnly() {
  const session = await getServerSession();
  if (!sessionRoles(session).includes("director")) return { session, denied: NextResponse.json({ error: "Аккаунты-источники правит директор" }, { status: 403 }) };
  return { session, denied: null };
}

/** Добавить аккаунт вручную { handle, kind }: ник, «@ник» или ссылка на профиль Instagram. */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const { session, denied } = await directorOnly();
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { handle?: unknown; kind?: unknown } | null;
  const handle = parseHandle(body?.handle);
  if (!handle) return NextResponse.json({ error: "Нужен ник Instagram или ссылка на профиль" }, { status: 400 });
  const kind = parseAccountKind(body?.kind);
  try {
    const result = await addSocialAccount(db, handle, kind);
    if (result === "migration_missing") return NextResponse.json({ error: SOCIAL_UNAVAILABLE }, { status: 503 });
    if (result === "conflict") return NextResponse.json({ error: "Аккаунт только что изменили — обновите список" }, { status: 409 });
    if (result !== "already") await audit(request, session, { action: "assortment.update", subject: `social-account:${handle}`, after: { added: result, kind } });
    return NextResponse.json({ handle, result }, { status: result === "created" ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Аккаунт не добавился" }, { status: 500 });
  }
}

/** Исключить { handle, action: "exclude" } — прогон его больше не обходит; вернуть { handle, action: "restore" } — снова наблюдается. */
export async function PATCH(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const { session, denied } = await directorOnly();
  if (denied) return denied;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { handle?: unknown; action?: unknown } | null;
  const handle = parseHandle(body?.handle);
  const action = body?.action === "exclude" || body?.action === "restore" ? body.action : null;
  if (!handle || !action) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  try {
    const result = await setSocialAccountStatus(db, handle, action);
    if (result === "migration_missing") return NextResponse.json({ error: SOCIAL_UNAVAILABLE }, { status: 503 });
    if (result === "not_found") return NextResponse.json({ error: "Аккаунт не найден" }, { status: 404 });
    if (result === "conflict") return NextResponse.json({ error: "Аккаунт только что изменили — обновите список" }, { status: 409 });
    if (result === "ok") await audit(request, session, { action: "assortment.update", subject: `social-account:${handle}`, after: { status: action === "exclude" ? "excluded" : "watched" } });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не получилось" }, { status: 500 });
  }
}
