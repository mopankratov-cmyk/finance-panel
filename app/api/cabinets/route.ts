import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validateWbToken } from "@/lib/wb/sellerInfo";
import { decodeWbToken, probeWbScope, probeWbScopes, type ScopeStatus } from "@/lib/wb/token";
import { validateOzon } from "@/lib/ozon/api";
import { cabinetBrandFilters } from "@/lib/wb/productScope";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const mask = (t: string) => (t ? "••••" + t.slice(-4) : "");

// GET — список кабинетов (токены замаскированы).
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ cabinets: [] });
  const cols = "id, name, marketplace, trade_mark, seller_id, client_id, inn, token, token_advert, token_content, token_feedbacks, brand_filters, is_active, created_at";
  const legacyCols = "id, name, marketplace, trade_mark, seller_id, client_id, inn, token, token_advert, token_content, token_feedbacks, is_active, created_at";
  type CabinetRow = Record<string, unknown> & { brand_filters?: unknown };
  const primary = await db
    .from("wb_cabinets")
    .select(cols)
    .order("created_at", { ascending: true });
  let data = primary.data as CabinetRow[] | null;
  let error = primary.error;
  if (error?.code === "42703") {
    const legacy = await db.from("wb_cabinets").select(legacyCols).order("created_at", { ascending: true });
    data = legacy.data as CabinetRow[] | null;
    error = legacy.error;
  }
  if (error) return NextResponse.json({ cabinets: [], error: error.message });
  const { data: scopeRows } = await db.from("wb_cabinet_product_scope").select("cabinet_id, nm_id").limit(10_000);
  const scopeCount = new Map<string, number>();
  for (const row of scopeRows ?? []) {
    const id = String(row.cabinet_id);
    scopeCount.set(id, (scopeCount.get(id) ?? 0) + 1);
  }
  const allCabinets = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    marketplace: c.marketplace ?? "wb",
    trade_mark: c.trade_mark,
    seller_id: c.seller_id,
    client_id: c.client_id,
    inn: c.inn,
    is_active: c.is_active,
    created_at: c.created_at,
    token_mask: mask(c.token as string),
    has_advert: !!c.token_advert,
    has_content: !!c.token_content,
    has_feedbacks: !!c.token_feedbacks,
    brand_filters: cabinetBrandFilters(`${String(c.name ?? "")} ${String(c.trade_mark ?? "")}`, c.brand_filters),
    product_scope_count: scopeCount.get(String(c.id)) ?? 0,
  }));
  const accessibleOnly = new URL(request.url).searchParams.get("accessible") === "1";
  const session = accessibleOnly ? await getServerSession() : null;
  const cabinets = accessibleOnly && session?.role === "manager" && session.cabinet_ids.length > 0
    ? allCabinets.filter((cabinet) => session.cabinet_ids.includes(String(cabinet.id)))
    : allCabinets;
  return NextResponse.json({ cabinets, count: cabinets.length });
}

// POST — добавить кабинет. WB: {token,...}. Ozon: {marketplace:'ozon', client_id, token=api_key, name?}.
export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as {
    marketplace?: string; token?: string; name?: string; client_id?: string; token_advert?: string; token_content?: string; token_feedbacks?: string;
    perf_client_id?: string; perf_secret?: string;
    brand_filters?: string[];
    allowed_products?: Array<{ nm_id?: number; article?: string; brand?: string }>;
  };
  const marketplace = b.marketplace === "ozon" ? "ozon" : "wb";
  const token = (b.token || "").trim();

  let row: Record<string, unknown>;
  // Отчёт по WB-токену для формы: какие категории доступны + срок действия.
  let scopeReport: { scopes: ScopeStatus; expiresAt: string | null; daysLeft: number | null; isTest: boolean } | undefined;
  if (marketplace === "ozon") {
    const clientId = (b.client_id || "").trim();
    if (!clientId || !token) return NextResponse.json({ error: "Укажите Client-Id и Api-Key Ozon" }, { status: 400 });
    const v = await validateOzon({ clientId, apiKey: token });
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const perfId = (b.perf_client_id || "").trim();
    const perfSecret = (b.perf_secret || "").trim();
    if (perfId && perfSecret) {
      const { validatePerf } = await import("@/lib/ozon/performance");
      if (!(await validatePerf({ clientId: perfId, secret: perfSecret })))
        return NextResponse.json({ error: "Performance-ключ невалиден" }, { status: 400 });
    }
    row = {
      marketplace: "ozon",
      name: (b.name || "").trim() || `Ozon ${clientId}`,
      seller_id: clientId, // для Ozon seller_id = Client-Id
      client_id: clientId,
      token, // Api-Key
      perf_client_id: perfId || null,
      perf_secret: perfSecret || null,
      is_active: true,
    };
  } else {
    if (!token) return NextResponse.json({ error: "Укажите API-токен WB" }, { status: 400 });
    const v = await validateWbToken(token);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const advTok = (b.token_advert || "").trim();
    const contTok = (b.token_content || "").trim();
    const feedbTok = (b.token_feedbacks || "").trim();
    // Категории основного токена + добор из отдельных токенов, если их указали.
    const scopes = await probeWbScopes(token);
    if (!scopes.advert && advTok) scopes.advert = await probeWbScope(advTok, "advert");
    if (!scopes.content && contTok) scopes.content = await probeWbScope(contTok, "content");
    if (!scopes.feedbacks && feedbTok) scopes.feedbacks = await probeWbScope(feedbTok, "feedbacks");
    const info = decodeWbToken(token);
    scopeReport = { scopes, expiresAt: info.expiresAt, daysLeft: info.daysLeft, isTest: info.isTest };
    row = {
      marketplace: "wb",
      name: (b.name || "").trim() || v.seller.tradeMark || v.seller.name || "Кабинет WB",
      trade_mark: v.seller.tradeMark ?? null,
      seller_id: v.seller.sid,
      inn: v.seller.tin ?? null,
      token,
      token_advert: advTok || null,
      token_content: contTok || null,
      token_feedbacks: feedbTok || null,
      is_active: true,
    };
    const cabinetName = String(row.name ?? "");
    if (b.brand_filters !== undefined || cabinetBrandFilters(cabinetName, []).length > 0) {
      row.brand_filters = cabinetBrandFilters(cabinetName, b.brand_filters);
    }
  }

  // без ON CONFLICT (уникальный индекс частичный): проверяем существование и обновляем/вставляем
  const { data: existing } = await db
    .from("wb_cabinets")
    .select("id")
    .eq("marketplace", marketplace)
    .eq("seller_id", row.seller_id as string)
    .maybeSingle();

  let data, error;
  if (existing?.id) {
    ({ data, error } = await db
      .from("wb_cabinets").update(row).eq("id", existing.id)
      .select("id, name, marketplace, seller_id, is_active, created_at").single());
  } else {
    ({ data, error } = await db
      .from("wb_cabinets").insert(row)
      .select("id, name, marketplace, seller_id, is_active, created_at").single());
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Кабинет не сохранён" }, { status: 500 });

  let productScopeCount: number | undefined;
  if (marketplace === "wb" && b.allowed_products !== undefined) {
    const products = [...new Map(
      b.allowed_products
        .map((p) => ({
          nm_id: Number(p.nm_id),
          article: String(p.article ?? "").trim() || null,
          brand: String(p.brand ?? "").trim() || null,
        }))
        .filter((p) => Number.isInteger(p.nm_id) && p.nm_id > 0)
        .map((p) => [p.nm_id, p]),
    ).values()];
    if (products.length > 10_000) {
      return NextResponse.json({ error: "Слишком большой товарный scope" }, { status: 400 });
    }
    const cabinetId = String(data.id);
    const { error: clearError } = await db.from("wb_cabinet_product_scope").delete().eq("cabinet_id", cabinetId);
    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 500 });
    if (products.length) {
      const { error: scopeError } = await db.from("wb_cabinet_product_scope").insert(
        products.map((p) => ({ cabinet_id: cabinetId, ...p })),
      );
      if (scopeError) return NextResponse.json({ error: scopeError.message }, { status: 500 });
    }
    productScopeCount = products.length;
  }

  return NextResponse.json({ ok: true, cabinet: data, product_scope_count: productScopeCount, ...scopeReport });
}
