/** Строка справочника товаров и её сборка из базы — общая для списка и карточки.
 *  Живёт в lib, потому что route-файл Next может экспортировать только обработчики. */
export interface ProductRow {
  id: string;
  legalEntityId: string | null;
  legalEntityName: string | null;
  article: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  nmId: number | null;
  photoUrl: string | null;
  factoryPrice: number | null;
  factoryCurrency: "CNY" | "RUB" | "USD";
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  volumeLiters: number | null;
  minStock: number | null;
  season: "summer" | "winter" | null;
  isActive: boolean;
  note: string | null;
  /** Чего не хватает, чтобы товар считался готовым к планированию закупки. */
  missing: string[];
}

export interface DbProduct {
  id: string;
  legal_entity_id: string | null;
  article: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  nm_id: number | null;
  photo_url: string | null;
  factory_price: number | null;
  factory_currency: "CNY" | "RUB" | "USD";
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  volume_liters: number | null;
  min_stock: number | null;
  season: "summer" | "winter" | null;
  is_active: boolean;
  note: string | null;
}

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function toProductRow(row: DbProduct, entityNames: Map<string, string>): ProductRow {
  // Позиция без цены фабрики или габаритов не считается в бюджете закупки и логистике —
  // молчать об этом нельзя, иначе итог занижается незаметно.
  const missing: string[] = [];
  if (row.factory_price === null) missing.push("себестоимость");
  if (row.weight_kg === null) missing.push("вес");
  if (row.length_cm === null || row.width_cm === null || row.height_cm === null) missing.push("габариты");

  return {
    id: String(row.id),
    legalEntityId: row.legal_entity_id,
    legalEntityName: row.legal_entity_id ? entityNames.get(row.legal_entity_id) ?? null : null,
    article: String(row.article),
    name: String(row.name ?? ""),
    barcode: row.barcode,
    category: row.category,
    brand: row.brand,
    nmId: row.nm_id === null ? null : Number(row.nm_id),
    photoUrl: row.photo_url,
    factoryPrice: number(row.factory_price),
    factoryCurrency: row.factory_currency ?? "CNY",
    weightKg: number(row.weight_kg),
    lengthCm: number(row.length_cm),
    widthCm: number(row.width_cm),
    heightCm: number(row.height_cm),
    volumeLiters: number(row.volume_liters),
    minStock: row.min_stock === null ? null : Number(row.min_stock),
    season: row.season,
    isActive: Boolean(row.is_active),
    note: row.note,
    missing,
  };
}

export const PRODUCT_COLUMNS =
  "id, legal_entity_id, article, name, barcode, category, brand, nm_id, photo_url, factory_price, factory_currency, weight_kg, length_cm, width_cm, height_cm, volume_liters, min_stock, season, is_active, note";
