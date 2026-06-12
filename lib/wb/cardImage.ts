// Фото карточки WB по nmId. URL детерминированный:
// https://basket-{NN}.wbbasket.ru/vol{vol}/part{part}/{nmId}/images/big/1.webp
// Номер basket зависит от vol по таблице диапазонов (WB периодически добавляет баскеты),
// поэтому вычисляем кандидат и проверяем HEAD-запросом, сканируя соседние при промахе.

// Верхние границы vol → номер basket (актуально на 2026)
const VOL_RANGES: [number, number][] = [
  [143, 1], [287, 2], [431, 3], [719, 4], [1007, 5], [1061, 6], [1115, 7],
  [1169, 8], [1313, 9], [1601, 10], [1655, 11], [1919, 12], [2045, 13],
  [2189, 14], [2405, 15], [2621, 16], [2837, 17], [3053, 18], [3269, 19],
  [3485, 20], [3700, 21], [3915, 22], [4130, 23], [4345, 24], [4560, 25],
];

function estimateBasket(vol: number): number {
  for (const [max, basket] of VOL_RANGES) {
    if (vol <= max) return basket;
  }
  // за пределами таблицы — грубая оценка (~215 vol на баскет)
  return 25 + Math.ceil((vol - 4560) / 215);
}

/** Синхронный best-effort URL фото карточки (без HEAD-проверки) — для списков. */
export function wbCardImageUrl(nmId: number, size = "c246x328"): string {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const b = estimateBasket(vol);
  return `https://basket-${String(b).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${size}/1.webp`;
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Возвращает URL главного фото карточки или null. */
export async function getWbCardImage(nmId: number): Promise<string | null> {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const build = (b: number) =>
    `https://basket-${String(b).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/big/1.webp`;

  const est = estimateBasket(vol);
  // порядок проверки: оценка, затем ±5 вокруг
  const tried = new Set<number>();
  const order: number[] = [est];
  for (let d = 1; d <= 5; d++) {
    order.push(est + d, est - d);
  }
  for (const b of order) {
    if (b < 1 || tried.has(b)) continue;
    tried.add(b);
    const url = build(b);
    if (await exists(url)) return url;
  }
  return null;
}
