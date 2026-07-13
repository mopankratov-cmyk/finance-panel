const BASE = "https://supplies-api.wildberries.ru/api/v1/supplies";

export interface FbwSupplyDetail extends Record<string, unknown> {
  statusID: number;
  boxTypeID: number;
  warehouseName: string;
  actualWarehouseName?: string;
  transitWarehouseName?: string;
  quantity: number;
}

export interface FbwSupplyGood {
  barcode: string;
  vendorCode: string;
  nmID: number;
  quantity: number;
}

export interface FbwSupplyPackage {
  packageCode: string;
  quantity: number;
  barcodes: { barcode: string; quantity: number }[];
}

export class WbFbwSupplyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WbFbwSupplyError";
  }
}

async function wbJson<T>(url: string, token: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, { headers: { Authorization: token.trim() }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status === 429 && attempt === 0) {
      const seconds = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(seconds) ? Math.min(5_000, Math.max(500, seconds * 1000)) : 2_100));
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new WbFbwSupplyError("WB-токен не имеет категории «Поставки»", response.status);
    if (response.status === 404) throw new WbFbwSupplyError("Поставка не найдена в выбранном WB-кабинете", 404);
    if (!response.ok) throw new WbFbwSupplyError(`WB ${response.status}: ${(await response.text()).slice(0, 240)}`, response.status);
    return await response.json() as T;
  }
  throw new WbFbwSupplyError("WB не ответил после повторной попытки", 502);
}

export async function fetchFbwSupplyDetail(token: string, supplyId: number) {
  return wbJson<FbwSupplyDetail>(`${BASE}/${supplyId}`, token);
}

export async function fetchFbwSupplyGoods(token: string, supplyId: number): Promise<FbwSupplyGood[]> {
  const result: FbwSupplyGood[] = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const page = await wbJson<FbwSupplyGood[]>(`${BASE}/${supplyId}/goods?limit=1000&offset=${offset}`, token);
    result.push(...page.map((row) => ({ barcode: String(row.barcode ?? ""), vendorCode: String(row.vendorCode ?? ""), nmID: Number(row.nmID ?? 0), quantity: Number(row.quantity ?? 0) })));
    if (page.length < 1000) return result;
  }
  throw new WbFbwSupplyError("В поставке больше 10 000 товарных строк — проверка остановлена", 422);
}

export async function fetchFbwSupplyPackage(token: string, supplyId: number): Promise<FbwSupplyPackage[]> {
  const rows = await wbJson<FbwSupplyPackage[]>(`${BASE}/${supplyId}/package`, token);
  return rows.map((row) => ({
    packageCode: String(row.packageCode ?? ""),
    quantity: Number(row.quantity ?? 0),
    barcodes: Array.isArray(row.barcodes) ? row.barcodes.map((item) => ({ barcode: String(item.barcode ?? ""), quantity: Number(item.quantity ?? 0) })) : [],
  }));
}

export async function fetchFbwSupplySnapshot(token: string, supplyId: number) {
  const packageRequest = fetchFbwSupplyPackage(token, supplyId).catch((error: unknown) => {
    // До ручной загрузки упаковки кабинет WB отвечает 400. Поставка при этом
    // существует и может быть связана; отсутствие раскладки покажем отдельно.
    if (error instanceof WbFbwSupplyError && error.status === 400) return [];
    throw error;
  });
  const [detail, goods, packages] = await Promise.all([
    fetchFbwSupplyDetail(token, supplyId),
    fetchFbwSupplyGoods(token, supplyId),
    packageRequest,
  ]);
  return { detail, goods, packages, capturedAt: new Date().toISOString() };
}
