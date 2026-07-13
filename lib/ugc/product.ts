import { fetchCabinetPimRows, type PimRow } from "@/lib/wb/cards";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

export class UgcProductError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function allowedUgcProducts(cabinetId: string): Promise<PimRow[]> {
  // Для scoped-кабинета allowlist читается до внешнего Content API.
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const rows = await fetchCabinetPimRows(cabinetId);
  return allowedNmIds === null ? rows : rows.filter((row) => allowedNmIds.has(row.nmId));
}

export async function loadUgcProduct(cabinetId: string, nmId: number): Promise<PimRow> {
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  if (allowedNmIds !== null && !allowedNmIds.has(nmId)) throw new UgcProductError("SKU не входит в товарный контур кабинета", 403);
  const product = (await fetchCabinetPimRows(cabinetId)).find((row) => row.nmId === nmId);
  // fetchCabinetPimRows повторно проверяет фактический бренд. Для Optima старый
  // nmID allowlist не может открыть товар, если WB уже возвращает другой бренд.
  if (!product) throw new UgcProductError("SKU не найден в выбранном кабинете", 404);
  return product;
}
