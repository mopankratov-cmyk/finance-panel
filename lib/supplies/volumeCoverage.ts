interface ProductDimensions {
  nmId: number;
  length: number | null;
  width: number | null;
  height: number | null;
}

export interface SupplyVolumeCoverage {
  known: number;
  total: number;
  litersByNm: Map<number, number>;
}

// WB отдаёт габариты карточки в сантиметрах. 1 литр = 1000 см³.
export function productVolumeLiters(dimensions: Pick<ProductDimensions, "length" | "width" | "height">): number | null {
  const length = Number(dimensions.length);
  const width = Number(dimensions.width);
  const height = Number(dimensions.height);
  if (![length, width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  return Math.round((length * width * height) / 10) / 100;
}

export function buildSupplyVolumeCoverage(nmIds: Iterable<number>, rows: ProductDimensions[]): SupplyVolumeCoverage {
  const uniqueNmIds = [...new Set(nmIds)];
  const wanted = new Set(uniqueNmIds);
  const litersByNm = new Map<number, number>();
  for (const row of rows) {
    if (!wanted.has(row.nmId) || litersByNm.has(row.nmId)) continue;
    const liters = productVolumeLiters(row);
    if (liters != null) litersByNm.set(row.nmId, liters);
  }
  return { known: litersByNm.size, total: uniqueNmIds.length, litersByNm };
}
