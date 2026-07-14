// Фото карточки WB по nmId. URL детерминированный:
// https://basket-{NN}.wbbasket.ru/vol{vol}/part{part}/{nmId}/images/big/1.webp
// Номер basket зависит от vol по таблице диапазонов (WB периодически добавляет баскеты),
// поэтому вычисляем кандидат и проверяем HEAD-запросом, сканируя соседние при промахе.

// Верхние границы vol → номер basket (WB периодически меняет разрезку).
const VOL_RANGES: [number, number][] = [
  [143, 1], [287, 2], [431, 3], [719, 4], [1007, 5], [1061, 6], [1115, 7],
  [1169, 8], [1313, 9], [1601, 10], [1655, 11], [1919, 12], [2045, 13],
  [2189, 14], [2405, 15], [2621, 16], [2837, 17], [3053, 18], [3269, 19],
  [3485, 20], [3700, 21], [3915, 22], [4130, 23], [4345, 24], [4560, 25],
  // выше 4560 баскеты идут шагом ~316 vol
  [4877, 26], [5193, 27], [5509, 28], [5825, 29], [6141, 30], [6457, 31],
  [6773, 32], [7089, 33], [7405, 34], [7721, 35], [8037, 36], [8353, 37],
  [8669, 38], [8985, 39], [9301, 40], [9617, 41], [9933, 42], [10249, 43],
  [10565, 44], [10881, 45], [11197, 46], [11513, 47], [11829, 48], [12145, 49],
  [12461, 50], [12777, 51], [13093, 52], [13409, 53], [13725, 54], [14041, 55],
];

// Наблюдение 2026-07-14: новые RIOBOX nm 1239272680/1239272678 (vol=12392)
// лежат на basket-44, хотя линейная таблица выше даёт basket-50. Без этого
// экраны рекламы/РНП/SEO получают битые миниатюры.
const VOL_OVERRIDES: [number, number, number][] = [
  [12146, 12777, 44],
];

function estimateBasketByRange(vol: number): number {
  for (const [max, basket] of VOL_RANGES) {
    if (vol <= max) return basket;
  }
  // за пределами таблицы — оценка тем же шагом ~316 vol на баскет
  return 55 + Math.ceil((vol - 14041) / 316);
}

function estimateBasket(vol: number): number {
  for (const [min, max, basket] of VOL_OVERRIDES) {
    if (vol >= min && vol <= max) return basket;
  }
  return estimateBasketByRange(vol);
}

export function wbCardImageBasketCandidates(nmId: number, radius = 18): number[] {
  const vol = Math.floor(nmId / 100000);
  const roots = new Set<number>([estimateBasket(vol), estimateBasketByRange(vol)]);
  for (const [, , basket] of VOL_OVERRIDES) roots.add(basket);

  const out: number[] = [];
  const push = (basket: number) => {
    if (basket >= 1 && basket <= 99 && !out.includes(basket)) out.push(basket);
  };
  for (const root of roots) {
    push(root);
    for (let d = 1; d <= radius; d++) {
      push(root - d);
      push(root + d);
    }
  }
  return out;
}

export function wbCardImageUrlCandidates(nmId: number, size = "c246x328", radius = 18): string[] {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  return wbCardImageBasketCandidates(nmId, radius).map((b) =>
    `https://basket-${String(b).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${size}/1.webp`,
  );
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
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Найти рабочий номер basket для nmId (по фото 1), либо 0. */
async function resolveBasket(nmId: number): Promise<number> {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  for (const b of wbCardImageBasketCandidates(nmId)) {
    if (await exists(`https://basket-${String(b).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/big/1.webp`)) return b;
  }
  return 0;
}

/** Все фото карточки (big .webp) по nmId. Кол-во берём из card.json, иначе последовательный пробинг. */
export async function getWbCardImages(nmId: number, size = "big"): Promise<string[]> {
  const basket = await resolveBasket(nmId);
  if (!basket) return [];
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const base = `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}`;
  let count = 0;
  try {
    const r = await fetch(`${base}/info/ru/card.json`, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { media?: { photo_count?: number }; photo_count?: number };
      count = Number(j?.media?.photo_count ?? j?.photo_count ?? 0);
    }
  } catch { /* падём на пробинг */ }
  const urls: string[] = [];
  if (count > 0) {
    for (let k = 1; k <= count; k++) urls.push(`${base}/images/${size}/${k}.webp`);
  } else {
    for (let k = 1; k <= 15; k++) {
      if (await exists(`${base}/images/big/${k}.webp`)) urls.push(`${base}/images/${size}/${k}.webp`);
      else break;
    }
  }
  return urls;
}

/** Возвращает URL главного фото карточки или null. */
export async function getWbCardImage(nmId: number): Promise<string | null> {
  const vol = Math.floor(nmId / 100000);
  const part = Math.floor(nmId / 1000);
  const build = (b: number) =>
    `https://basket-${String(b).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/big/1.webp`;

  for (const b of wbCardImageBasketCandidates(nmId)) {
    const url = build(b);
    if (await exists(url)) return url;
  }
  return null;
}
