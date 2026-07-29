// Коэффициенты приёмки складов — официальный WB Tariffs API, не WMS/МойСклад.
// В декабре 2025 WB перенёс метод с supplies-api на common-api, а старый адрес
// отключил 3 февраля 2026. Новый метод принимает токен любой категории.
const URL_ = "https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients";

export interface AcceptanceCoef {
  date: string;
  warehouseID: number;
  warehouseName: string;
  boxTypeName: string;
  coefficient: number; // -1 = приёмка закрыта, 0 = бесплатно, >0 = платный коэффициент
  allowUnload: boolean;
}

export class WbSuppliesAuthError extends Error {
  constructor() {
    super("WB-токен недействителен или не имеет доступа к тарифам на поставку");
    this.name = "WbSuppliesAuthError";
  }
}

export async function fetchAcceptanceCoefficients(token: string, warehouseIds?: number[]): Promise<AcceptanceCoef[]> {
  const u = new URL(URL_);
  if (warehouseIds?.length) u.searchParams.set("warehouseIDs", warehouseIds.join(","));
  const res = await fetch(u.toString(), {
    headers: { Authorization: token.trim() },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new WbSuppliesAuthError();
  if (!res.ok) throw new Error(`WB ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(json)) return [];
  return json.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      date: String(o.date ?? ""),
      warehouseID: Number(o.warehouseID ?? 0),
      warehouseName: String(o.warehouseName ?? ""),
      boxTypeName: String(o.boxTypeName ?? o.boxTypeID ?? ""),
      coefficient: Number(o.coefficient ?? -1),
      allowUnload: Boolean(o.allowUnload ?? false),
    };
  });
}
