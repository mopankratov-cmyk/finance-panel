import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { getMoySkladContext } from "@/lib/moysklad/api";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const raw = new URL(request.url).searchParams.get("cabinet");
  const cabinetId = raw && raw !== "all" && !raw.startsWith("group:") ? (await resolveShopCabinet(raw)).cabinetId : null;
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403);
  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const [connectionResult, taraResult, settingsResult] = await Promise.all([
    db.from("moysklad_connection").select("id, token, account_name, organization_href, organization_name, store_href, store_name, last_sync_at, last_sync_error").eq("cabinet_id", cabinetId).eq("is_active", true).maybeSingle(),
    db.from("wms_tara_imports").select("id, file_name, summary, updated_at").eq("cabinet_id", cabinetId).eq("status", "active").maybeSingle(),
    db.from("supply_distribution_settings").select("warehouse_shares, excluded_nm_ids, updated_at").eq("cabinet_id", cabinetId).maybeSingle(),
  ]);
  const databaseError = connectionResult.error ?? taraResult.error ?? settingsResult.error;
  if (databaseError) {
    const migrationMissing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(databaseError.code ?? "");
    return fail(migrationMissing ? "Примените миграцию 20260713_wms_tara.sql" : databaseError.message, migrationMissing ? 503 : 500);
  }

  const connection = connectionResult.data as Record<string, unknown> | null;
  let references: { organizations: Awaited<ReturnType<typeof getMoySkladContext>>["organizations"]; stores: Awaited<ReturnType<typeof getMoySkladContext>>["stores"] } = { organizations: [], stores: [] };
  let connectionError: string | null = null;
  if (connection?.token) {
    try {
      references = await getMoySkladContext(String(connection.token));
      await db.from("moysklad_connection").update({ last_sync_at: new Date().toISOString(), last_sync_error: null }).eq("id", connection.id);
    } catch (error) {
      connectionError = error instanceof Error ? error.message : "МойСклад недоступен";
      await db.from("moysklad_connection").update({ last_sync_at: new Date().toISOString(), last_sync_error: connectionError }).eq("id", connection.id);
    }
  }
  const organizationSelected = Boolean(connection?.organization_href && references.organizations.some((item) => item.meta.href === connection.organization_href));
  const storeSelected = !connection?.store_href || references.stores.some((item) => item.meta.href === connection.store_href);
  const checks = [
    { key: "connection", name: "МойСклад", ok: Boolean(connection) && !connectionError, detail: connectionError ?? (connection ? `Подключено: ${connection.account_name ?? "аккаунт"}` : "Токен не подключён") },
    { key: "organization", name: "Юрлицо", ok: organizationSelected, detail: organizationSelected ? String(connection?.organization_name ?? "Выбрано") : "Выберите доступное юрлицо" },
    { key: "store", name: "Склад-источник", ok: storeSelected, detail: connection?.store_name ? String(connection.store_name) : "Не задан — допустимо для внутреннего заказа" },
    { key: "tara", name: "Готовая тара", ok: Boolean(taraResult.data), detail: taraResult.data ? `${taraResult.data.file_name} · ${Number((taraResult.data.summary as { containers?: number })?.containers ?? 0)} коробов` : "Загрузите containerscontent.xlsx" },
    { key: "distribution", name: "Распределение", ok: Boolean(settingsResult.data && Array.isArray(settingsResult.data.warehouse_shares) && settingsResult.data.warehouse_shares.length), detail: settingsResult.data ? `${(settingsResult.data.warehouse_shares as unknown[]).length} складов` : "Сохраните сценарий распределения" },
  ];
  return NextResponse.json({
    data: {
      ok: checks.every((check) => check.ok),
      checks,
      references,
      selected: { organizationHref: connection?.organization_href ?? null, storeHref: connection?.store_href ?? null },
      tara: taraResult.data ?? null,
    },
    error: null,
  });
}
