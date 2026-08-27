export interface OpiuBrand {
  id: string;
  label: string;
  /** Юрлицо (как в product_costs.entity / opiu_warehouse_costs.entity). */
  entity: string;
  /** WB-кабинет, к которому фактически относятся SKU этого юрлица. */
  cabinetId: string;
}

// Соответствие юрлицо → WB-кабинет сверено по факту: пересечение article между
// product_costs (по entity) и supplier_article в wb_orders (по cabinet_id) —
// см. историю чата/PR. Для ИП Кучеренко — CLERIN, для ИП Панкратова — COSMOS SHOP.
export const OPIU_BRANDS: OpiuBrand[] = [
  {
    id: "pankratov",
    label: "ИП Панкратов",
    entity: "ИП ПАНКРАТОВ",
    cabinetId: "b7b8b4ee-ceec-4539-a209-174b16a413d7", // COSMOS SHOP
  },
  {
    id: "kucherenko",
    label: "ИП Кучеренко",
    entity: "ИП КУЧЕРЕНКО",
    cabinetId: "5a571d13-3c0d-4843-91ad-d68a605ba0de", // CLERIN
  },
];

export const DEFAULT_OPIU_BRAND_ID = OPIU_BRANDS[0]!.id;

export function resolveOpiuBrand(brandId: string | null | undefined): OpiuBrand {
  return OPIU_BRANDS.find((b) => b.id === brandId) ?? OPIU_BRANDS[0]!;
}

/** @deprecated используй resolveOpiuBrand(...).entity — оставлено для кода, ещё не переведённого на мультибренд. */
export const OPIU_ENTITY = OPIU_BRANDS[0]!.entity;
/** @deprecated используй resolveOpiuBrand(...).cabinetId — оставлено для кода, ещё не переведённого на мультибренд. */
export const OPIU_WB_CABINET_ID = OPIU_BRANDS[0]!.cabinetId;
