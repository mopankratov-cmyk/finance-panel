// Обратный решатель цены: «какая цена нужна под целевую маржу».
// Маржа здесь — маржинальный доход к выручке (как «Рентабельность МД, %» в ОПиУ):
//   profit/ед = R·(1 − f) − cogs,  margin = profit/R = (1 − f) − cogs/R
// где R — выручка/ед (цена после всех скидок/СПП), f — доля выручки на удержания МП
// (комиссия + эквайринг + логистика/хранение/штрафы + overhead), cogs — себестоимость/ед.
// Обратный ход:  R* = cogs / (1 − f − m).  Реклама (ДРР) учитывается отдельно репрайсером.
//
// Δ цены = R*/R_текущая − 1 — он же равен Δ каталожной цены (пропорция R↔каталог постоянна),
// поэтому целевую каталожную цену даём только когда известна текущая каталожная.

export interface SolverInput {
  /** себестоимость, ₽/ед */
  cogs: number;
  /** доля выручки на все удержания МП (0..1): комиссия+эквайринг+extra+overhead */
  feeFraction: number;
  /** текущая выручка/ед (цена после СПП), ₽ */
  currentRevenue: number;
  /** текущая каталожная цена (до скидки/СПП), ₽ — опционально */
  currentCatalogPrice?: number | null;
  /** целевые маржи, % (напр. [15, 25, 35]) */
  margins: number[];
}

export interface SolverTarget {
  margin: number;
  /** нужная выручка/ед под маржу, ₽ (null если недостижимо) */
  neededRevenue: number | null;
  /** нужная каталожная цена, ₽ (null если нет текущей каталожной или недостижимо) */
  neededCatalogPrice: number | null;
  /** Δ к текущей цене, % (null если нет текущей выручки) */
  deltaPct: number | null;
  /** достижима ли маржа при конечной цене (f + m < 1 и есть себестоимость) */
  reachable: boolean;
}

export interface SolverResult {
  feeFraction: number;
  /** текущая маржа МД, % (null если нет данных) */
  currentMarginPct: number | null;
  targets: SolverTarget[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function solvePrices(input: SolverInput): SolverResult {
  const { cogs, feeFraction: f, currentRevenue, currentCatalogPrice, margins } = input;

  const currentMarginPct =
    currentRevenue > 0 && cogs > 0 ? round2(((1 - f) - cogs / currentRevenue) * 100) : null;

  const targets: SolverTarget[] = margins.map((marginPct) => {
    const m = marginPct / 100;
    const denom = 1 - f - m;
    const reachable = cogs > 0 && denom > 1e-6;
    if (!reachable) {
      return { margin: marginPct, neededRevenue: null, neededCatalogPrice: null, deltaPct: null, reachable: false };
    }
    const neededRevenue = cogs / denom;
    const ratio = currentRevenue > 0 ? neededRevenue / currentRevenue : null;
    const deltaPct = ratio != null ? round2((ratio - 1) * 100) : null;
    const neededCatalogPrice =
      ratio != null && currentCatalogPrice && currentCatalogPrice > 0
        ? Math.round(currentCatalogPrice * ratio)
        : null;
    return {
      margin: marginPct,
      neededRevenue: Math.round(neededRevenue),
      neededCatalogPrice,
      deltaPct,
      reachable: true,
    };
  });

  return { feeFraction: round2(f), currentMarginPct, targets };
}

/** Каталожная цена, дающая ровно `marginPct` маржи — для margin_floor репрайсера.
 *  Возвращает null если недостижимо или нет текущих ориентиров. */
export function priceForMargin(input: Omit<SolverInput, "margins"> & { marginPct: number }): number | null {
  const r = solvePrices({ ...input, margins: [input.marginPct] });
  return r.targets[0]?.neededCatalogPrice ?? null;
}
