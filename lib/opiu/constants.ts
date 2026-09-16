export interface OpiuBrand {
  id: string;
  label: string;
  /** Юрлицо (как в product_costs.entity / opiu_warehouse_costs.entity). */
  entity: string;
  /** WB-кабинет, к которому фактически относятся SKU этого юрлица. */
  cabinetId: string;
  /**
   * Суб-бренд внутри общего кабинета/юрлица — если задано, из потока
   * заказов/отчёта/себестоимости кабинета берутся только строки, чей
   * артикул начинается с одного из этих префиксов (регистронезависимо).
   * Нужно, когда несколько брендов продаются с одного WB-аккаунта
   * (Norvia/Heaton — оба на кабинете Retail Family, разделяются только
   * по префиксу артикула NV-/HT-, юрлицо у product_costs общее).
   */
  articlePrefixes?: string[];
}

// Соответствие юрлицо → WB-кабинет сверено по факту: пересечение article между
// product_costs (по entity) и supplier_article в wb_orders (по cabinet_id) —
// см. историю чата/PR. Для ИП Кучеренко — CLERIN, для ИП Панкратова — COSMOS SHOP.
// Norvia/Heaton — суб-бренды внутри Retail Family, различаются по префиксу
// артикула (NV-/HT-), а не по кабинету — см. articlePrefixes выше.
// Riobox/Heaton/Norvia — суб-бренды внутри кабинета Оптима (id сверен в БД по
// wb_cabinets.name), различаются по префиксу артикула: ESC (Riobox), NV-,
// HT- — те же товары/себестоимость (product_costs матчится по артикулу
// глобально, не по entity), что и у Retail Family для NV-/HT-.
export const OPIU_BRANDS: OpiuBrand[] = [
  {
    id: "pankratov",
    label: "CosmosShop",
    entity: "ИП ПАНКРАТОВ",
    cabinetId: "b7b8b4ee-ceec-4539-a209-174b16a413d7", // COSMOS SHOP
  },
  {
    id: "kucherenko",
    label: "CLERIN",
    entity: "ИП КУЧЕРЕНКО",
    cabinetId: "5a571d13-3c0d-4843-91ad-d68a605ba0de", // CLERIN
  },
  {
    id: "norvia",
    label: "Norvia",
    entity: "Retail Family",
    cabinetId: "1f173bb0-e687-4f06-9bb8-a1a44d5621bf", // Retail Family
    articlePrefixes: ["NV-"],
  },
  {
    id: "heaton",
    label: "Heaton",
    entity: "Retail Family",
    cabinetId: "1f173bb0-e687-4f06-9bb8-a1a44d5621bf", // Retail Family
    articlePrefixes: ["HT-"],
  },
  {
    id: "optima-riobox",
    label: "Riobox",
    entity: "ООО РИО",
    cabinetId: "d43854d4-5bb7-49ac-a7d4-ecd619330c20", // Оптима — NORVIA / RIOBOX
    articlePrefixes: ["ESC"],
  },
  {
    id: "optima-norvia",
    label: "Norvia",
    entity: "Retail Family",
    cabinetId: "d43854d4-5bb7-49ac-a7d4-ecd619330c20", // Оптима — NORVIA / RIOBOX
    articlePrefixes: ["NV-"],
  },
  {
    id: "optima-heaton",
    label: "Heaton",
    entity: "Retail Family",
    cabinetId: "d43854d4-5bb7-49ac-a7d4-ecd619330c20", // Оптима — NORVIA / RIOBOX
    articlePrefixes: ["HT-"],
  },
];

export const DEFAULT_OPIU_BRAND_ID = OPIU_BRANDS[0]!.id;

/** Юрлицо в разрезе UI-фильтра "Юр лицо" → какие бренды из OPIU_BRANDS ему показывать. */
export interface OpiuLegalEntity {
  id: string;
  label: string;
  brandIds: string[];
}

export const OPIU_LEGAL_ENTITIES: OpiuLegalEntity[] = [
  { id: "optima", label: "Оптима", brandIds: ["optima-riobox", "optima-heaton", "optima-norvia"] },
  { id: "pankratov", label: "ИП Панкратов", brandIds: ["pankratov"] },
  { id: "kucherenko", label: "ИП Кучеренко", brandIds: ["kucherenko"] },
  { id: "filippov", label: "ИП Филиппов", brandIds: ["norvia", "heaton"] },
];

export const DEFAULT_OPIU_LEGAL_ENTITY_ID =
  OPIU_LEGAL_ENTITIES.find((e) => e.brandIds.includes(DEFAULT_OPIU_BRAND_ID))!.id;

/** Бренды, разрешённые для данного набора выбранных юрлиц (объединение, без дублей). */
export function brandIdsForLegalEntities(entityIds: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const entityId of entityIds) {
    const entity = OPIU_LEGAL_ENTITIES.find((e) => e.id === entityId);
    if (!entity) continue;
    for (const brandId of entity.brandIds) ids.add(brandId);
  }
  return ids;
}

export function resolveOpiuBrand(brandId: string | null | undefined): OpiuBrand {
  return OPIU_BRANDS.find((b) => b.id === brandId) ?? OPIU_BRANDS[0]!;
}

/**
 * Мультибренд-версия resolveOpiuBrand — для свода сразу по нескольким брендам
 * (суммирование). Неизвестные id молча отбрасываются, дубликаты схлопываются;
 * если после этого список пуст — откат на бренд по умолчанию (то же поведение,
 * что и у resolveOpiuBrand с некорректным/пустым id).
 */
export function resolveOpiuBrands(brandIds: readonly string[] | null | undefined): OpiuBrand[] {
  const uniqueIds = [...new Set((brandIds ?? []).filter((id) => OPIU_BRANDS.some((b) => b.id === id)))];
  if (uniqueIds.length === 0) return [OPIU_BRANDS[0]!];
  return uniqueIds.map((id) => resolveOpiuBrand(id));
}

/**
 * WB-кабинеты, реально нужные ОПиУ — 3 уникальных cabinetId (Retail Family
 * общий для Norvia/Heaton). Синки, которые тянут данные ИСКЛЮЧИТЕЛЬНО для
 * ОПиУ (paid-storage, advert-spend-history) должны фильтроваться по этому
 * набору — иначе тянут вообще все активные кабинеты аккаунта (Оптима,
 * Слоёно и другие, не относящиеся к ОПиУ), впустую тратя лимиты WB API и
 * время крона на данные, которые никто не читает.
 */
export const OPIU_CABINET_IDS: ReadonlySet<string> = new Set(OPIU_BRANDS.map((b) => b.cabinetId));

/** Сколько суб-брендов (включая сам brand) делят один WB-кабинет по префиксу артикула. */
export function siblingBrandCount(brand: OpiuBrand): number {
  if (!brand.articlePrefixes?.length) return 1;
  return OPIU_BRANDS.filter((b) => b.cabinetId === brand.cabinetId && b.articlePrefixes?.length).length || 1;
}

/** @deprecated используй resolveOpiuBrand(...).entity — оставлено для кода, ещё не переведённого на мультибренд. */
export const OPIU_ENTITY = OPIU_BRANDS[0]!.entity;
/** @deprecated используй resolveOpiuBrand(...).cabinetId — оставлено для кода, ещё не переведённого на мультибренд. */
export const OPIU_WB_CABINET_ID = OPIU_BRANDS[0]!.cabinetId;
