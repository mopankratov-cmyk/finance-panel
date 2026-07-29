import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getServerSession } from "@/lib/auth/server";
import { getMoySkladContext, validateMoySkladToken } from "@/lib/moysklad/api";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const mask = (token: string) => token ? `••••${token.slice(-4)}` : "";
const missingMigration = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");
const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

async function selected(raw: string | null) {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

async function allowedCabinet(raw: string | null) {
  const cabinetId = await selected(raw);
  if (!cabinetId) return { error: fail("Выберите один реальный WB-кабинет", 400), cabinetId: null };
  if (!(await hasCabinetAccess(cabinetId))) return { error: fail("Нет доступа к кабинету", 403), cabinetId: null };
  return { error: null, cabinetId };
}

const publicStatus = (row: Record<string, unknown>) => ({
  connected: Boolean(row.is_active),
  accountName: row.account_name as string | null,
  tokenMask: mask(String(row.token ?? "")),
  organization: row.organization_href ? { href: String(row.organization_href), name: String(row.organization_name ?? "") } : null,
  store: row.store_href ? { href: String(row.store_href), name: String(row.store_name ?? "") } : null,
  lastSyncAt: row.last_sync_at as string | null,
  lastSyncError: row.last_sync_error as string | null,
});

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await allowedCabinet(new URL(request.url).searchParams.get("cabinet"));
  if (scope.error) return scope.error;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data, error } = await db.from("moysklad_connection").select("token, account_name, is_active, organization_href, organization_name, store_href, store_name, last_sync_at, last_sync_error").eq("cabinet_id", scope.cabinetId).maybeSingle();
  if (error) return fail(missingMigration(error.code) ? "Примените миграцию 20260713_wms_tara.sql" : error.message, missingMigration(error.code) ? 503 : 500);
  return NextResponse.json({ data: data && data.is_active ? publicStatus(data as Record<string, unknown>) : { connected: false }, error: null });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { cabinetId?: string; token?: string } | null;
  if (!body) return fail("Некорректное тело запроса", 400);
  const scope = await allowedCabinet(body.cabinetId ?? null);
  if (scope.error) return scope.error;
  const token = String(body.token ?? "").trim();
  if (!token) return fail("Укажите API-токен МойСклад", 400);
  const validation = await validateMoySkladToken(token);
  if (!validation.ok) return fail(validation.error, 400);
  let context;
  try { context = await getMoySkladContext(token); } catch (error) { return fail(error instanceof Error ? error.message : "Не удалось прочитать справочники МойСклад", 400); }
  const organization = context.organizations[0];
  if (!organization) return fail("В МойСклад нет доступного юрлица", 400);
  const store = context.stores[0] ?? null;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const session = await getServerSession();
  const row = {
    cabinet_id: scope.cabinetId,
    token,
    account_name: validation.accountName,
    is_active: true,
    organization_href: organization.meta.href,
    organization_name: organization.name,
    store_href: store?.meta.href ?? null,
    store_name: store?.name ?? null,
    connected_by: session?.email ?? null,
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: readError } = await db.from("moysklad_connection").select("id").eq("cabinet_id", scope.cabinetId).maybeSingle();
  if (readError) return fail(missingMigration(readError.code) ? "Примените миграцию 20260713_wms_tara.sql" : readError.message, missingMigration(readError.code) ? 503 : 500);
  const result = existing?.id
    ? await db.from("moysklad_connection").update(row).eq("id", existing.id)
    : await db.from("moysklad_connection").insert(row);
  if (result.error) return fail(result.error.message, 500);
  return NextResponse.json({ data: { ...publicStatus(row), organizations: context.organizations, stores: context.stores }, error: null });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const body = await request.json().catch(() => null) as { cabinetId?: string; organizationHref?: string; storeHref?: string | null } | null;
  if (!body) return fail("Некорректное тело запроса", 400);
  const scope = await allowedCabinet(body.cabinetId ?? null);
  if (scope.error) return scope.error;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { data: connection, error } = await db.from("moysklad_connection").select("id, token").eq("cabinet_id", scope.cabinetId).eq("is_active", true).maybeSingle();
  if (error || !connection) return fail(error?.message ?? "МойСклад не подключён", error ? 500 : 404);
  let context;
  try { context = await getMoySkladContext(String(connection.token)); } catch (cause) { return fail(cause instanceof Error ? cause.message : "МойСклад недоступен", 400); }
  const organization = context.organizations.find((item) => item.meta.href === body.organizationHref);
  const store = body.storeHref ? context.stores.find((item) => item.meta.href === body.storeHref) : null;
  if (!organization) return fail("Выбранное юрлицо недоступно этому токену", 400);
  if (body.storeHref && !store) return fail("Выбранный склад недоступен этому токену", 400);
  const result = await db.from("moysklad_connection").update({ organization_href: organization.meta.href, organization_name: organization.name, store_href: store?.meta.href ?? null, store_name: store?.name ?? null, updated_at: new Date().toISOString() }).eq("id", connection.id);
  if (result.error) return fail(result.error.message, 500);
  return NextResponse.json({ data: { organization, store }, error: null });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await allowedCabinet(new URL(request.url).searchParams.get("cabinet"));
  if (scope.error) return scope.error;
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);
  const { error } = await db.from("moysklad_connection").update({ is_active: false, updated_at: new Date().toISOString() }).eq("cabinet_id", scope.cabinetId).eq("is_active", true);
  if (error) return fail(error.message, 500);
  return NextResponse.json({ data: { ok: true }, error: null });
}
