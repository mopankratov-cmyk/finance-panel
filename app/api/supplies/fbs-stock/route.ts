import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import {
  FbsBarcodeCatalogColdError,
  loadFbsBarcodeCatalogHourly,
  warmFbsBarcodeCatalog,
  type FbsBarcodeCatalog,
} from "@/lib/wb/fbsBarcodeCatalog";
import { fetchFbsStocks, fetchFbsWarehouses, WbFbsApiError } from "@/lib/wb/fbsMarketplace";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
// Пользовательский заход укладывается в секунды: справочник баркодов берётся
// готовым снимком. Длинный лимит нужен только прогреву (?refresh=1), которому
// разрешён холодный обход Content API — см. lib/wb/fbsBarcodeCatalog.ts.
export const maxDuration = 300;

export interface FbsStockRow {
  barcode: string;
  nmId: number;
  article: string;
  brand: string;
  size: string;
  amount: number;
}

export interface FbsStockWarehouse {
  id: number;
  name: string;
}

export interface FbsStockResponse {
  meta: {
    cabinetId: string;
    generatedAt: string;
    status: "ready" | "partial";
    warnings: string[];
  };
  data: {
    warehouses: FbsStockWarehouse[];
    warehouseId: number | null;
    warehouseName: string;
    /** false — снимок баркодов кабинета ещё не собран, остатки спросить не по чему. */
    catalogReady: boolean;
    rows: FbsStockRow[];
    /** Баркодов кабинета, по которым WB спросили. */
    skuChecked: number;
    /** Из них с нулевым остатком (в таблицу не попадают). */
    zeroSkus: number;
    totalAmount: number;
  } | null;
  error: string | null;
}

/** Потолок опроса: 1000 баркодов на запрос, WB держит общий лимитер на продавца. */
const MAX_SKUS = 8_000;

const metaEnvelope = (cabinetId: string, warnings: string[] = [], status: "ready" | "partial" = "ready") => ({
  cabinetId,
  generatedAt: new Date().toISOString(),
  status,
  warnings,
});

function fail(message: string, httpStatus: number, cabinetId = ""): NextResponse<FbsStockResponse> {
  return NextResponse.json<FbsStockResponse>(
    { meta: metaEnvelope(cabinetId), data: null, error: message },
    { status: httpStatus },
  );
}

async function resolveCabinetId(raw: string | null): Promise<string | null> {
  if (!raw || raw === "all" || raw.startsWith("group:")) return null;
  return (await resolveShopCabinet(raw)).cabinetId;
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const params = new URL(request.url).searchParams;
  const cabinetId = await resolveCabinetId(params.get("cabinet"));
  if (!cabinetId) return fail("Выберите один реальный WB-кабинет", 400);
  if (!(await hasCabinetAccess(cabinetId))) return fail("Нет доступа к кабинету", 403, cabinetId);

  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return fail("WB-кабинет не найден", 404, cabinetId);

  const requestedWarehouse = Number(params.get("warehouse") ?? Number.NaN);
  // ?refresh=1 — прогрев: только этому пути разрешён холодный обход Content API.
  const warmRun = params.get("refresh") === "1";
  const deadlineMs = Date.now() + (warmRun ? 240_000 : 45_000);
  const token = resolveWbToken(cabinet, "marketplace");
  const warnings: string[] = [];

  try {
    const warehouses = await fetchFbsWarehouses(token);
    if (!warehouses.length) {
      return NextResponse.json<FbsStockResponse>({
        meta: metaEnvelope(cabinetId, ["В кабинете WB нет ни одного склада продавца — остатки FBS вести негде."]),
        data: { warehouses: [], warehouseId: null, warehouseName: "", catalogReady: true, rows: [], skuChecked: 0, zeroSkus: 0, totalAmount: 0 },
        error: null,
      });
    }

    // Склад подменять молча нельзя: пользователь выбрал бы один, а увидел другой.
    const requested = Number.isFinite(requestedWarehouse)
      ? warehouses.find((item) => item.id === requestedWarehouse)
      : undefined;
    const warehouse = requested ?? warehouses[0];
    if (Number.isFinite(requestedWarehouse) && !requested) {
      warnings.push(`Склад ${requestedWarehouse} в кабинете не найден — показан «${warehouse.name}».`);
    }

    // Справочник баркодов читаем только готовым снимком. Нет снимка — честно
    // говорим «ещё не прогрет» вместо получасового обхода в лямбде пользователя.
    const readCatalog = async (): Promise<FbsBarcodeCatalog | null> => {
      try {
        return warmRun
          ? await warmFbsBarcodeCatalog(cabinetId)
          : await loadFbsBarcodeCatalogHourly(cabinetId, { cacheOnly: true });
      } catch (error) {
        if (error instanceof FbsBarcodeCatalogColdError) return null;
        throw error;
      }
    };
    const [catalog, allowedNmIds] = await Promise.all([readCatalog(), requestAllowedNmIds(cabinetId)]);

    if (!catalog) {
      return NextResponse.json<FbsStockResponse>({
        meta: metaEnvelope(
          cabinetId,
          [
            ...warnings,
            "Справочник баркодов кабинета ещё не прогрет: WB отдаёт остатки склада продавца только по списку баркодов, а собирается он фоновым обходом карточек. Загляните позже.",
          ],
          "partial",
        ),
        data: {
          warehouses: warehouses.map((item) => ({ id: item.id, name: item.name })),
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          catalogReady: false,
          rows: [],
          skuChecked: 0,
          zeroSkus: 0,
          totalAmount: 0,
        },
        error: null,
      });
    }

    if (!catalog.complete) {
      warnings.push("Каталог карточек прочитан не до конца — по части баркодов остаток не спрашивали.");
    }

    const scoped = catalog.entries.filter((entry) => requestAllowsNm(allowedNmIds, entry.nmId));
    const droppedByScope = catalog.entries.length - scoped.length;
    if (droppedByScope > 0) {
      warnings.push(`${droppedByScope} баркодов вне товарного контура кабинета скрыто.`);
    }
    if (!scoped.length) {
      warnings.push("У карточек кабинета нет баркодов — WB отдаёт остатки склада продавца только по списку баркодов.");
    }

    const probed = scoped.slice(0, MAX_SKUS);
    if (scoped.length > probed.length) {
      warnings.push(`Остаток спрошен по ${probed.length} баркодам из ${scoped.length} — WB опрашивается пачками по 1000.`);
    }

    const stocks = await fetchFbsStocks(token, warehouse.id, probed.map((entry) => entry.barcode), { deadlineMs });
    if (!stocks.complete) {
      warnings.push("Опрос остатков остановлен по времени — показана часть баркодов.");
    }

    let zeroSkus = 0;
    const rows: FbsStockRow[] = [];
    for (const entry of probed) {
      const amount = stocks.amounts.get(entry.barcode);
      if (amount === undefined) continue;
      if (amount <= 0) {
        zeroSkus += 1;
        continue;
      }
      rows.push({ barcode: entry.barcode, nmId: entry.nmId, article: entry.article, brand: entry.brand, size: entry.size, amount });
    }
    rows.sort((left, right) => right.amount - left.amount || left.article.localeCompare(right.article, "ru"));

    const partial = !catalog.complete || !stocks.complete || scoped.length > probed.length;
    return NextResponse.json<FbsStockResponse>({
      meta: metaEnvelope(cabinetId, warnings, partial ? "partial" : "ready"),
      data: {
        warehouses: warehouses.map((item) => ({ id: item.id, name: item.name })),
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        catalogReady: true,
        rows,
        skuChecked: stocks.checked,
        zeroSkus,
        totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
      },
      error: null,
    });
  } catch (error) {
    if (error instanceof WbFbsApiError) return fail(error.message, error.status >= 400 && error.status < 600 ? error.status : 502, cabinetId);
    return fail(error instanceof Error ? error.message : "Не удалось загрузить остатки FBS", 500, cabinetId);
  }
}
