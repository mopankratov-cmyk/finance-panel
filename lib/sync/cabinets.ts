// Цели синхронизации WB: по одному на активный кабинет из wb_cabinets.
// Если кабинетов ещё нет — fallback на ENV-токены (поведение 1:1 как раньше,
// существующие строки помечены cabinet_id = NULL).

import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import type { WbProductScope } from "@/lib/wb/productScope";
import { allowsBrand, isScoped, normalizeWbBrand } from "@/lib/wb/productScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWbCardPages, type WbCardCursor } from "@/lib/wb/cardPagination";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

export interface SyncTarget {
  cabinetId: string | null; // null = ENV-кабинет (legacy-строки)
  name: string;
  statsToken: string; // Статистика + Аналитика (orders/sales/stocks/funnel)
  advertToken: string; // Продвижение (adverts/advert-stats)
  contentToken: string; // Карточки товаров: полный каталог + точный бренд
  productScope: WbProductScope; // null allowlist = весь кабинет; массив = только выбранные nm_id
  // Лимит supplier/orders и supplier/sales действует на продавца, а не на токен.
  // Несколько виртуальных кабинетов одного seller должны делить один API-вызов.
  statisticsSourceKey?: string;
}

export function wbStatisticsSourceKey(input: {
  sellerId?: string | null;
  inn?: string | null;
  token: string;
}): string {
  if (input.sellerId?.trim()) return `seller:${input.sellerId.trim()}`;
  if (input.inn?.trim()) return `inn:${input.inn.trim()}`;
  try {
    const payload = JSON.parse(Buffer.from(input.token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      oid?: string | number;
      sid?: string | number;
    };
    // oid — организация продавца; sid оставлен fallback для старых JWT.
    const identity = payload.oid ?? payload.sid;
    if (identity != null && String(identity).trim()) return `jwt-seller:${String(identity).trim()}`;
  } catch {
    // Legacy/non-JWT токены группируются только при полном совпадении.
  }
  return `token:${input.token}`;
}

export function groupWbStatisticsTargets(targets: readonly SyncTarget[]): SyncTarget[][] {
  const groups = new Map<string, SyncTarget[]>();
  for (const target of targets) {
    const key = target.statisticsSourceKey || target.statsToken;
    const group = groups.get(key) ?? [];
    group.push(target);
    groups.set(key, group);
  }
  return [...groups.values()];
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
      statisticsSourceKey: wbStatisticsSourceKey({ sellerId: c.seller_id, inn: c.inn, token: c.token }),
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
      statisticsSourceKey: wbStatisticsSourceKey({ token: env }),
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
  const discovered = new Set<number>();
  const db = getSupabaseAdmin();
  const saved = db ? await readWbSyncState(db, target.cabinetId, "product-scope") : null;
  if (db && !(await claimWbSyncJob(db, target.cabinetId, "product-scope", 15 * 60))) return 0;
  let startCursor: WbCardCursor = {};
  try {
    startCursor = saved?.cursor ? JSON.parse(saved.cursor) as WbCardCursor : {};
  } catch {
    startCursor = {};
  }
  let totalScanned = Number(saved?.state.totalScanned ?? 0);
  let allowedCount = Number(saved?.state.allowedCount ?? target.productScope.allowedNmIds?.length ?? 0);
  let norviaCount = Number(saved?.state.norviaCount ?? 0);
  let rioBoxCount = Number(saved?.state.rioBoxCount ?? 0);
  let currentCursor = startCursor;

  try {
    const result = await fetchWbCardPages<Record<string, unknown>>({
      token: target.contentToken,
      startCursor,
      // В serverless-слоте обрабатываем ограниченную пачку и обязательно сохраняем
      // continuation cursor. Локальные/тестовые вызовы без БД могут пройти весь каталог.
      maxPagesThisRun: db ? 20 : 1_000,
      fetchImpl,
      onPage: async (page) => {
        currentCursor = page.cursor;
        if (db) {
          // Если бренд карточки изменился на запрещённый, старый allowlist не должен
          // продолжать пропускать этот nmID в источниках, где WB не отдаёт бренд.
          const rejectedNmIds = [...new Set(page.rows
            .filter((row) => !allowsBrand(target.productScope, row.brand ?? row.brandName))
            .map((row) => Number(row.nmID ?? row.nmId ?? row.nm_id))
            .filter((nmId) => Number.isInteger(nmId) && nmId > 0))];
          for (let offset = 0; offset < rejectedNmIds.length; offset += 500) {
            const rejected = rejectedNmIds.slice(offset, offset + 500);
            const { error } = await db.from("wb_cabinet_product_scope")
              .delete()
              .eq("cabinet_id", target.cabinetId!)
              .in("nm_id", rejected);
            if (error) throw new Error(`product scope cleanup: ${error.message}`);
          }
          if (rejectedNmIds.length && target.productScope.allowedNmIds) {
            const rejected = new Set(rejectedNmIds);
            target.productScope.allowedNmIds = target.productScope.allowedNmIds.filter((nmId) => !rejected.has(nmId));
          }
        }
        const products = cabinetProductCandidates(target, page.rows).filter((product) => {
          if (discovered.has(product.nm_id)) return false;
          discovered.add(product.nm_id);
          return true;
        });
        if (products.length) await persistProducts(target, products);
        totalScanned += page.rows.length;
        allowedCount += products.length;
        norviaCount += products.filter((product) => normalizeWbBrand(product.brand) === "norvia").length;
        rioBoxCount += products.filter((product) => normalizeWbBrand(product.brand) === "riobox").length;
        if (db) {
          const stateError = await writeWbSyncState(db, target.cabinetId!, "product-scope", {
            cursor: JSON.stringify(page.cursor),
            status: page.caughtUp ? "caught_up" : "running",
            attempts: 0,
            lastError: null,
            state: {
              totalScanned,
              allowedCount,
              norviaCount,
              rioBoxCount,
              lastPageRows: page.rows.length,
              lastRunAt: new Date().toISOString(),
              caughtUp: page.caughtUp,
            },
          });
          if (stateError) throw new Error(`product scope state: ${stateError}`);
        }
      },
    });
    if (db && !result.caughtUp) {
      await writeWbSyncState(db, target.cabinetId, "product-scope", {
        cursor: JSON.stringify(result.cursor),
        // Пагинация безопасно остановилась и сохранила курсор; следующий
        // запуск может продолжить сразу, не ожидая истечения watchdog lease.
        status: "pending",
        attempts: 0,
        lastError: null,
        state: { totalScanned, allowedCount, norviaCount, rioBoxCount, lastRunAt: new Date().toISOString(), caughtUp: false },
      });
    }
    return discovered.size;
  } catch (error) {
    if (db) {
      await writeWbSyncState(db, target.cabinetId, "product-scope", {
        cursor: JSON.stringify(currentCursor),
        status: "error",
        attempts: (saved?.attempts ?? 0) + 1,
        lastError: error instanceof Error ? error.message : "Не удалось загрузить каталог",
        state: { ...(saved?.state ?? {}), lastRunAt: new Date().toISOString() },
      });
    }
    throw error;
  }
}
