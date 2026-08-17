// Ручной порядок выдачи артикулов кабинета. Хранится одним массивом nm_id
// (wb_sku_order), настраивается в РНП, применяется на всех экранах со
// списками SKU: перечисленные артикулы идут в заданном порядке, остальные —
// после них с сохранением исходной сортировки экрана (стабильно).

export function buildSkuOrderIndex(nmIds: readonly number[]): Map<number, number> {
  const index = new Map<number, number>();
  nmIds.forEach((nm, position) => {
    if (Number.isInteger(nm) && nm > 0 && !index.has(nm)) index.set(nm, position);
  });
  return index;
}

export function sortByCustomSkuOrder<T>(
  items: readonly T[],
  getNm: (item: T) => number | null | undefined,
  orderIndex: ReadonlyMap<number, number>,
): T[] {
  if (!orderIndex.size) return [...items];
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftNm = getNm(left.item);
      const rightNm = getNm(right.item);
      const leftPos = leftNm != null ? orderIndex.get(leftNm) : undefined;
      const rightPos = rightNm != null ? orderIndex.get(rightNm) : undefined;
      if (leftPos != null && rightPos != null) return leftPos - rightPos;
      if (leftPos != null) return -1;
      if (rightPos != null) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * Разбор вставленного списка: числа из любых разделителей, порядок и
 * уникальность сохраняются. Числа короче шести знаков отбрасываются: реальные
 * nmID WB длиннее, а при копировании из таблицы вместе с колонкой «№» в текст
 * попадают порядковые номера строк.
 */
export function parseSkuOrderInput(text: string): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const token of text.split(/[^0-9]+/)) {
    if (!token) continue;
    const nm = Number(token);
    if (!Number.isInteger(nm) || nm < 100000 || seen.has(nm)) continue;
    seen.add(nm);
    result.push(nm);
  }
  return result;
}

export const SKU_ORDER_LIMIT = 2000;
