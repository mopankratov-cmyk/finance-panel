// Цели синхронизации WB: по одному на активный кабинет из wb_cabinets.
// Если кабинетов ещё нет — fallback на ENV-токены (поведение 1:1 как раньше,
// существующие строки помечены cabinet_id = NULL).

import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import type { WbProductScope } from "@/lib/wb/productScope";
import { allowsBrand, isScoped } from "@/lib/wb/productScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export interface SyncTarget {
  cabinetId: string | null; // null = ENV-кабинет (legacy-строки)
  name: string;
  statsToken: string; // Статистика + Аналитика (orders/sales/stocks/funnel)
  advertToken: string; // Продвижение (adverts/advert-stats)
  contentToken: string; // Карточки товаров: полный каталог + точный бренд
  productScope: WbProductScope; // null allowlist = весь кабинет; массив = только выбранные nm_id
}

export async function getWbSyncTargets(): Promise<SyncTarget[]> {
  const cabs = await getActiveWbCabinets();
  if (cabs.length) {
    return cabs.map((c) => ({
      cabinetId: c.id,
      name: c.name,
      statsToken: c.token,
      advertToken: c.token_advert || c.token,
      contentToken: c.token_content || c.token,
      productScope: cabinetProductScope(c),
    }));
  }
  const env = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
  if (!env) return [];
  return [
    {
      cabinetId: null,
      name: "env",
      statsToken: env,
      advertToken: process.env.WB_TOKEN_ADVERT || env,
      contentToken: process.env.WB_TOKEN_CONTENT || env,
      productScope: { brandFilters: [], allowedNmIds: null },
    },
  ];
}

// Курсор: последняя дата в таблице в разрезе кабинета (для инкрементального dateFrom).
export async function lastSyncDate(table: string, cabinetId: string | null): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  let q = db.from(table).select("date").order("date", { ascending: false }).limit(1);
  q = cabinetId === null ? q.is("cabinet_id", null) : q.eq("cabinet_id", cabinetId);
  const { data } = await q.maybeSingle();
  return (data as { date?: string } | null)?.date ?? null;
}

export interface CabinetProductCandidate {
  nm_id: number;
  article: string | null;
  brand: string | null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface DiscoverCabinetProductsOptions {
  fetchImpl?: FetchLike;
  persistProducts?: (target: SyncTarget, products: CabinetProductCandidate[]) => Promise<void>;
}

const WB_CARDS_URL = "https://content-api.wildberries.ru/content/v2/get/cards/list";

export function cabinetProductCandidates(
  target: SyncTarget,
  rows: Record<string, unknown>[],
): CabinetProductCandidate[] {
  const scoped = isScoped(target.productScope);
  return [...new Map(
    rows
      .filter((row) => !scoped || allowsBrand(target.productScope, row.brand ?? row.brandName))
      .map((row) => ({
        nm_id: Number(row.nmId ?? row.nmID ?? row.nm_id),
        article: String(row.supplierArticle ?? row.vendorCode ?? "").trim() || null,
        brand: String(row.brand ?? row.brandName ?? "").trim() || null,
      }))
      .filter((row) => Number.isInteger(row.nm_id) && row.nm_id > 0)
      .map((row) => [row.nm_id, row]),
  ).values()];
}

async function persistCabinetProducts(target: SyncTarget, products: CabinetProductCandidate[]): Promise<void> {
  if (!target.cabinetId || !products.length) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  const { error } = await db.from("wb_cabinet_product_scope").upsert(
    products.map((row) => ({ cabinet_id: target.cabinetId, ...row })),
    { onConflict: "cabinet_id,nm_id" },
  );
  if (error) throw new Error(`product scope: ${error.message}`);

  if (isScoped(target.productScope)) {
    const current = target.productScope.allowedNmIds ?? [];
    target.productScope.allowedNmIds = [...new Set([...current, ...products.map((row) => row.nm_id)])];
  }
}

// Orders/sales дают scoped-кабинету быстрый инкрементальный каталог:
// до upsert сохраняются только SKU разрешённых брендов.
export async function rememberScopedProducts(
  target: SyncTarget,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!isScoped(target.productScope)) return;
  await persistCabinetProducts(target, cabinetProductCandidates(target, rows));
}

// Остатки WB не возвращают бренд. Перед их загрузкой читаем полный каталог карточек,
// чтобы новый SKU нужного бренда попал в allowlist даже без первого заказа.
export async function discoverCabinetProducts(
  target: SyncTarget,
  options: DiscoverCabinetProductsOptions = {},
): Promise<number> {
  // Полный каталог нужен именно для брендового контура. Обычные кабинеты
  // остаются unrestricted и не засоряют allowlist служебными строками.
  if (!target.cabinetId || !isScoped(target.productScope)) return 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const persistProducts = options.persistProducts ?? persistCabinetProducts;
  let cursor: { updatedAt?: string; nmID?: number } = {};
  const discovered = new Set<number>();

  for (let page = 0; page < 30; page++) {
    const response = await fetchImpl(WB_CARDS_URL, {
      method: "POST",
      headers: { Authorization: target.contentToken, "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { cursor: { limit: 100, ...cursor }, filter: { withPhoto: -1 } } }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`WB Content API ${response.status}: ${(await response.text()).slice(0, 160)}`);
    }
    const payload = (await response.json()) as {
      cards?: Record<string, unknown>[];
      cursor?: { updatedAt?: string; nmID?: number };
    };
    const batch = Array.isArray(payload.cards) ? payload.cards : [];
    const products = cabinetProductCandidates(target, batch).filter((product) => {
      if (discovered.has(product.nm_id)) return false;
      discovered.add(product.nm_id);
      return true;
    });
    if (products.length) await persistProducts(target, products);
    if (batch.length < 100) break;
    cursor = { updatedAt: payload.cursor?.updatedAt, nmID: payload.cursor?.nmID };
  }

  return discovered.size;
}
