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

// Подтверждённые замером точки vol→basket. Линейная таблица выше устарела для
// новых томов: WB замедлил разрезку, и шаг «316 vol на баскет» уводит оценку.
// Замер 2026-08-13 (последовательный HEAD с ретраями — параллельный WB режет):
//   vol 12392 → 44, vol 12441 → 44, vol 13387 → 45.
// То есть между 12441 и 13387 баскет сменился один раз, а не трижды.
// Без этого новые карточки NORVIA (vol 13387) получали basket-53 и пустые миниатюры.
const VOL_OVERRIDES: [number, number, number][] = [
  [12146, 12777, 44],
  [12778, 13500, 45],
];

function estimateBasketByRange(vol: number): number {
  for (const [max, basket] of VOL_RANGES) {
    if (vol <= max) return basket;
  }
  // За пределами таблицы: по замерам 2026-08 разрезка идёт примерно 950 vol на
  // баскет, а не 316. Прежний шаг уводил оценку на 8 баскетов и давал пустые фото.
  return 46 + Math.ceil((vol - 13500) / 950);
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

export function extractWbNmIdFromImageUrl(src: string | null | undefined): number | null {
  const value = String(src ?? "");
  const match = value.match(/\/(\d{5,12})\/images\//) ?? value.match(/\/catalog\/(\d{5,12})(?:\/|$)/);
  const nmId = Number(match?.[1] ?? 0);
  return Number.isInteger(nmId) && nmId > 0 ? nmId : null;
}

export function wbCardImageUrlsForDisplay(input: { nmId?: number | null; src?: string | null; size?: string; radius?: number }): string[] {
  const src = String(input.src ?? "").trim();
  const nmId = Number(input.nmId ?? extractWbNmIdFromImageUrl(src) ?? 0);
  const urls = src ? [src] : [];
  if (Number.isInteger(nmId) && nmId > 0) urls.push(...wbCardImageUrlCandidates(nmId, input.size ?? "c246x328", input.radius ?? 18));
  return [...new Set(urls)];
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

/**
 * Реальный номер баскета для тома, спрошенный у WB, а не вычисленный.
 *
 * Формула по таблице диапазонов протухает при каждой новой разрезке WB — за месяц
 * это уже третья заплатка. Здесь мы один раз проверяем HEAD-запросом и запоминаем.
 * Ключ — ТОМ, а не карточка: все карточки одного тома лежат в одном баскете,
 * поэтому на кабинет уходит 3-5 проверок вместо тысячи.
 *
 * Проверяем ПОСЛЕДОВАТЕЛЬНО с паузой: параллельные запросы WB режет, и они
 * возвращают ложное «фото не найдено» — на этом легко построить неверный вывод.
 */
const basketByVol = new Map<number, number>();
/** Тома, про которые известно, что живого фото у них нет: спрашивать WB незачем. */
const knownEmptyVols = new Set<number>();
/** Сколько секунд экран готов ждать опрос баскетов у WB. */
const BASKET_PROBE_BUDGET_MS = 2500;

async function probeBasket(vol: number, nmId: number): Promise<number> {
  const part = Math.floor(nmId / 1000);
  for (const basket of wbCardImageBasketCandidates(nmId, 8)) {
    const url = `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/c246x328/1.webp`;
    if (await exists(url)) return basket;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return 0;
}

/**
 * Возвращает номер баскета тома. 0 — проверить не удалось: вызывающий должен
 * откатиться на оценку по таблице, а не показывать пустоту.
 */
export async function resolveWbBasketForVol(nmId: number): Promise<number> {
  const vol = Math.floor(nmId / 100000);
  const cached = basketByVol.get(vol);
  if (cached != null) return cached;
  const basket = await probeBasket(vol, nmId);
  if (basket) basketByVol.set(vol, basket);
  return basket;
}

/**
 * URL миниатюр для набора карточек с проверкой баскета по томам.
 * Ошибка проверки не роняет список — такие карточки получают оценку по таблице.
 */
export async function wbCardImageUrlsByNmIds(nmIds: number[], size = "c246x328"): Promise<Map<number, string>> {
  const byVol = new Map<number, number>();
  for (const nmId of nmIds) {
    const vol = Math.floor(nmId / 100000);
    if (!byVol.has(vol)) byVol.set(vol, nmId);
  }

  // Известные тома берём из базы: Map ниже живёт внутри процесса, и на каждом
  // холодном инстансе лямбды опрос WB начинался заново — на кабинете в 467
  // артикулов это десятки последовательных HEAD с ретраями и почти двадцать
  // секунд внутри сборки РНП. Импорт динамический: модуль изоморфен, а
  // серверный Supabase в клиентский бандл тащить нельзя.
  const unknownVols = [...byVol.keys()].filter((vol) => !basketByVol.has(vol) && !knownEmptyVols.has(vol));
  let store: typeof import("./basketVols") | null = null;
  if (unknownVols.length) {
    store = await import("./basketVols").catch(() => null);
    const known = store ? await store.loadKnownBasketVols(unknownVols).catch(() => new Map<number, number>()) : new Map<number, number>();
    for (const [vol, basket] of known) {
      // Ноль из базы — это ответ «фото у тома нет», а не отсутствие ответа.
      // Раньше нули отбрасывались, такие тома снова считались неизвестными и
      // опрашивались у WB каждый прогон: справочник наполнялся, а время не
      // падало.
      if (basket > 0) basketByVol.set(vol, basket);
      else knownEmptyVols.add(vol);
    }
  }

  const stillUnknown = [...byVol.entries()].filter(([vol]) => !basketByVol.has(vol) && !knownEmptyVols.has(vol));
  if (stillUnknown.length) {
    // Опрос WB под секундомером: экран не должен ждать сеть дольше, чем
    // стоит миниатюра. Не успели — отдаём оценку по таблице, а следующий
    // прогон дособерёт остаток и положит его в базу.
    const probes = Promise.all(stillUnknown.map(async ([vol, nmId]) => {
      const basket = await resolveWbBasketForVol(nmId).catch(() => 0);
      return [vol, basket] as const;
    }));
    // Запись подвешена к самому опросу, а не к гонке с таймером: иначе при
    // срабатывании секундомера результат выбрасывался целиком, база не
    // наполнялась, и каждый следующий прогон снова упирался в тот же лимит.
    // Ноль тоже запоминаем — «живого фото у тома нет» такой же факт.
    if (store) {
      const target = store;
      void probes.then((rows) => {
        for (const [vol, basket] of rows) if (!basket) knownEmptyVols.add(vol);
        return target.rememberBasketVols(new Map(rows));
      }).catch(() => {});
    }
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), BASKET_PROBE_BUDGET_MS));
    await Promise.race([probes, timeout]);
  }

  const out = new Map<number, string>();
  for (const nmId of nmIds) {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    const basket = basketByVol.get(vol) ?? estimateBasket(vol);
    out.set(nmId, `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}/images/${size}/1.webp`);
  }
  return out;
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
