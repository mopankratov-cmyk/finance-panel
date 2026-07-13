export interface PlanningBlock {
  orders: number[];
  norms: Record<string, unknown>;
  sku_orders: Record<string, number[]>;
}

export interface PlanningState extends Partial<PlanningBlock> {
  by_cabinet?: Record<string, Partial<PlanningBlock>>;
  [key: string]: unknown;
}

const emptyOrders = () => Array.from({ length: 12 }, () => 0);

function normalizeOrders(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 12) return emptyOrders();
  return value.map((item) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : 0;
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSkuOrders(value: unknown): Record<string, number[]> {
  const source = normalizeRecord(value);
  return Object.fromEntries(
    Object.entries(source).map(([article, months]) => [article, normalizeOrders(months)]),
  );
}

export function normalizePlanningBlock(value: unknown): PlanningBlock {
  const block = normalizeRecord(value);
  return {
    orders: normalizeOrders(block.orders),
    norms: normalizeRecord(block.norms),
    sku_orders: normalizeSkuOrders(block.sku_orders),
  };
}

export function selectPlanningBlock(state: PlanningState, cabinetId: string | null): PlanningBlock {
  const scoped = cabinetId ? state.by_cabinet?.[cabinetId] : undefined;
  // Старые записи содержат один общий блок. Пока у кабинета нет своего плана,
  // используем его как стартовый шаблон, не теряя обратную совместимость.
  return normalizePlanningBlock(scoped ?? state);
}

export function mergePlanningBlock(
  state: PlanningState,
  cabinetId: string | null,
  block: PlanningBlock,
): PlanningState {
  const normalized = normalizePlanningBlock(block);
  if (!cabinetId) return { ...state, ...normalized };
  return {
    ...state,
    by_cabinet: {
      ...(state.by_cabinet ?? {}),
      [cabinetId]: normalized,
    },
  };
}
