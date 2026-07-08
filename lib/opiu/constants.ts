/** Юрлицо для отчёта ОПиУ (как в product_costs.entity) */
export const OPIU_ENTITY = "ИП ПАНКРАТОВ";

// WB-кабинет, к которому фактически относятся все SKU юрлица ИП ПАНКРАТОВ — сверено
// по факту (100% заказов по article из product_costs идут через этот cabinet_id).
// Токен для отчёта берём из wb_cabinets по этому id, а не из ENV (тот был отозван WB).
export const OPIU_WB_CABINET_ID = "b7b8b4ee-ceec-4539-a209-174b16a413d7"; // COSMOS SHOP
