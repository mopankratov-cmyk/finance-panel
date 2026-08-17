// Срезы цен конкурентов из блока «Смотрите также» (раздел «Полки»).
// Правила перенесены из рабочих наработок автора (apps-script/PriceWriter.gs,
// свежее приложенного ТЗ):
//  - срезы Топ-3/6/12/30 считаются по порядку показа среди НЕисключённых
//    конкурентов с известной ценой (исключённых выбрасываем, срез сдвигается);
//  - «+» разницы = конкуренты ДОРОЖЕ нас (наша цена — база 0%);
//  - 0 подходящих в срезе — это не ошибка и не пустота, а явное состояние
//    «только свои товары»;
//  - подходящих меньше N — считаем по тому, что есть, и подписываем
//    «доступно X из N» вместо молчаливой подмены.

export const SHELF_SLICES = [3, 6, 12, 30] as const;

export interface ShelfRow {
  position: number;
  nmId: number | null;
  brand: string | null;
  price: number | null;
  img: string | null;
}

export interface ShelfMarkedRow extends ShelfRow {
  excluded: boolean;
}

export interface ShelfSliceResult {
  n: number;
  /** «Топ-6» либо «Топ-30 (доступно 12 из 30)» */
  label: string;
  /** Средняя цена по срезу; null — «только свои товары» либо нет цен */
  avgPrice: number | null;
  /** (средняя − наша)/наша × 100; null — нет базы (наша цена не снята) или нет среза */
  diffPct: number | null;
  eligibleCount: number;
  onlyOwn: boolean;
  note: string | null;
}

export function normalizeShelfBrand(brand: string | null | undefined): string {
  return String(brand ?? "").trim().toLowerCase();
}

/**
 * Множество исключённых брендов: собственный бренд артикула (авто) + ручные
 * списки (по артикулу и глобальный по кабинету). Пустой бренд никогда не
 * считается исключённым — «бренд не указан» не повод выбрасывать конкурента.
 */
export function buildShelfExclusionSet(
  ourBrand: string | null | undefined,
  extraBrands: readonly string[] = [],
  globalBrands: readonly string[] = [],
): Set<string> {
  const set = new Set<string>();
  for (const brand of [ourBrand, ...extraBrands, ...globalBrands]) {
    const normalized = normalizeShelfBrand(brand);
    if (normalized) set.add(normalized);
  }
  return set;
}

export function isShelfBrandExcluded(brand: string | null | undefined, exclusionSet: ReadonlySet<string>): boolean {
  const normalized = normalizeShelfBrand(brand);
  if (!normalized) return false;
  return exclusionSet.has(normalized);
}

export function markShelfRows(rows: readonly ShelfRow[], exclusionSet: ReadonlySet<string>): ShelfMarkedRow[] {
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row) => ({ ...row, excluded: isShelfBrandExcluded(row.brand, exclusionSet) }));
}

/** (другая − наша)/наша × 100. Положительное — сравниваемая цена выше нашей. */
export function shelfDiffPct(ourPrice: number, otherPrice: number): number {
  return ((otherPrice - ourPrice) / ourPrice) * 100;
}

export function computeShelfSlices(
  rows: readonly ShelfRow[],
  ourPrice: number | null,
  exclusionSet: ReadonlySet<string>,
): ShelfSliceResult[] {
  const marked = markShelfRows(rows, exclusionSet);
  const nonExcluded = marked.filter((row) => !row.excluded);
  const eligible = nonExcluded.filter((row) => row.price != null);

  return SHELF_SLICES.map((n) => {
    const slice = eligible.slice(0, n);
    if (slice.length === 0) {
      // Три разных пустоты, и путать их нельзя: «только свои товары» — вывод
      // про рынок, а «конкуренты/цены не сняты» — про качество сбора.
      const onlyOwn = marked.length > 0 && nonExcluded.length === 0;
      return {
        n,
        label: `Топ-${n}`,
        avgPrice: null,
        diffPct: null,
        eligibleCount: 0,
        onlyOwn,
        note: onlyOwn ? "только свои товары"
          : marked.length === 0 ? "конкуренты в этом сборе не сняты"
            : "цены конкурентов не сняты",
      };
    }
    const avgPrice = slice.reduce((sum, row) => sum + Number(row.price), 0) / slice.length;
    const hasBase = ourPrice != null && ourPrice > 0;
    return {
      n,
      label: slice.length < n ? `Топ-${n} (доступно ${slice.length} из ${n})` : `Топ-${n}`,
      avgPrice,
      diffPct: hasBase ? shelfDiffPct(ourPrice, avgPrice) : null,
      eligibleCount: slice.length,
      onlyOwn: false,
      note: hasBase ? null : "наша цена не снята — сравнить не с чем",
    };
  });
}
