// Коэффициенты приёмки складов — официальный WB Supplies API, не WMS/МойСклад
// (ранее "Проверить ограничения складов" ошибочно считался невозможным без WMS —
// это отдельный официальный эндпоинт). Токен категории «Поставки» — если у
// существующего токена его нет, WB вернёт 401/403, отдаём понятную ошибку.
const URL_ = "https://supplies-api.wildberries.ru/api/v1/acceptance/coefficients";

export interface AcceptanceCoef {
  date: string;
  warehouseID: number;
  warehouseName: string;
  boxTypeName: string;
  coefficient: number; // -1 = приёмка закрыта, 0 = бесплатно, >0 = платный коэффициент
  allowUnload: boolean;
}

export class WbSuppliesScopeError extends Error {
  constructor() {
    super("Нет доступа к коэффициентам приёмки (нужен WB-токен с категорией «Поставки»)");
    this.name = "WbSuppliesScopeError";
  }
}

export async function fetchAcceptanceCoefficients(token: string, warehouseIds?: number[]): Promise<AcceptanceCoef[]> {
  const u = new URL(URL_);
  if (warehouseIds?.length) u.searchParams.set("warehouseIDs", warehouseIds.join(","));
  const res = await fetch(u.toString(), { headers: { Authorization: token.trim() }, cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new WbSuppliesScopeError();
  if (!res.ok) throw new Error(`WB ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(json)) return [];
  return json.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      date: String(o.date ?? ""),
      warehouseID: Number(o.warehouseID ?? 0),
      warehouseName: String(o.warehouseName ?? ""),
      boxTypeName: String(o.boxTypeName ?? ""),
      coefficient: Number(o.coefficient ?? -1),
      allowUnload: Boolean(o.allowUnload ?? false),
    };
  });
}
