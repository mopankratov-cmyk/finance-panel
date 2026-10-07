import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { sessionRoles } from "@/lib/auth/session";
import { audit } from "@/lib/audit/log";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import {
  addToShortlist, canEditFactories, factoriesTab, FACTORY_ONLY_BAGS_WORDS, FactoryConflictError, FactoryInputError, FactoryNotFoundError, FactoryTableMissingError,
  loadShortlist, patchShortlist, purgeExpiredSearches, type ShortlistView,
} from "@/lib/assortment/factoryShortlist";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof FactoryInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof FactoryNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof FactoryConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof FactoryTableMissingError) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ error: `${fallback}: ${error instanceof Error ? error.message : "ошибка"}` }, { status: 500 });
}

/**
 * Шорт-лист фабрик сумок. GET ?direction=bags — { tab, shortlist, canEdit, items }: смотрят все роли модуля; вкладки нет без ключа 1688
 * и вне «Сумок», шорт-листа нет без миграции (причина одной строкой). ?count=1 — только «есть ли вкладка» ({ tab, canEdit }) без базы:
 * его спрашивает раздел «Сумки» при каждом открытии. Шорт-лист не меняется; заодно стираются выдачи поиска старше 7 дней (кэш — не
 * дольше недели, даже если никто не ищет).
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const session = await getServerSession();
  const tab = factoriesTab(parseDirection(request.nextUrl.searchParams.get("direction")));
  const canEdit = canEditFactories(sessionRoles(session));
  if (request.nextUrl.searchParams.get("count") === "1") return NextResponse.json({ tab, canEdit }, { headers: NO_STORE });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  if (!tab.visible) {
    const view: ShortlistView = { tab, shortlist: { available: false, reason: tab.reason }, canEdit, items: [] };
    return NextResponse.json(view, { headers: NO_STORE });
  }
  try {
    await purgeExpiredSearches(db, Date.now());
    const list = await loadShortlist(db);
    const view: ShortlistView = { tab, shortlist: { available: list.available, reason: list.reason }, canEdit, items: list.items };
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Шорт-лист не загрузился");
  }
}

/** «В шорт-лист» { direction: "bags", searchId, key } — нажимает человек; снимок берётся из кэша поиска на сервере. Закупщик и директор. */
export async function POST(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const session = await getServerSession();
  if (!canEditFactories(sessionRoles(session))) return NextResponse.json({ error: "Добавлять в шорт-лист может закупщик или директор" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { direction?: unknown; searchId?: unknown; key?: unknown } | null;
  if (parseDirection(typeof body?.direction === "string" ? body.direction : null) !== "bags") return NextResponse.json({ error: FACTORY_ONLY_BAGS_WORDS }, { status: 400 });
  const searchId = typeof body?.searchId === "string" && UUID_RE.test(body.searchId) ? body.searchId : null;
  const key = typeof body?.key === "string" && body.key.length >= 5 && body.key.length <= 420 ? body.key : null;
  if (!searchId || !key) return NextResponse.json({ error: "Неверная фабрика" }, { status: 400 });
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    const added = await addToShortlist(db, { searchId, key, who });
    if (added.created) await audit(request, session, { action: "assortment.update", subject: `cn-factory:${added.item.id}`, after: { shortlisted: true, status: added.item.status } });
    return NextResponse.json(added, { status: added.created ? 201 : 200, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Не получилось добавить в шорт-лист");
  }
}

/**
 * Правка записи { id, status?, reason?, checklist?, note?, updatedAt? }: статус ставит только человек (отклонение — с причиной), смена
 * статуса пишется в историю; пункты чек-листа — раздельно; заметка — без телефонов, WeChat и почты. Закупщик и директор.
 */
export async function PATCH(request: Request) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const session = await getServerSession();
  if (!canEditFactories(sessionRoles(session))) return NextResponse.json({ error: "Править шорт-лист может закупщик или директор" }, { status: 403 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown; reason?: unknown; checklist?: unknown; note?: unknown; updatedAt?: unknown } | null;
  const id = typeof body?.id === "string" && UUID_RE.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Неверная запись" }, { status: 400 });
  const who = session?.email ?? session?.uid ?? "неизвестно";
  try {
    const item = await patchShortlist(db, { id, patch: { status: body?.status, reason: body?.reason, checklist: body?.checklist, note: body?.note, updatedAt: body?.updatedAt }, who });
    await audit(request, session, {
      action: body?.status !== undefined ? "assortment.decision" : "assortment.update",
      subject: `cn-factory:${id}`,
      after: { status: item.status, checklist: body?.checklist !== undefined ? Object.keys(item.checklist) : undefined, note: body?.note !== undefined ? Boolean(item.note) : undefined },
    });
    return NextResponse.json({ item }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Правка не сохранилась");
  }
}
