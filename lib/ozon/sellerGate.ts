// Ворота к Ozon Seller API: не больше двух запросов в секунду на один Client-Id.
//
// Ozon считает лимит по клиенту целиком, а не по эндпоинту, и отвечает
// `429 rate limit exceeded for 'seller-api' client, current max rate per sec.: 2`.
// Экран «План · факт» ловил это на первой же странице: он читает аналитику
// постранично, потом параллельно картинки и остатки — три источника подряд без
// единой паузы, и первый же ответ 429 обрывал загрузку целиком.
//
// Поэтому запросы одного кабинета выстраиваются в очередь с интервалом, а не
// летят пачкой. Очередь общая для всех вызовов процесса: разводить её по
// эндпоинтам бессмысленно — лимит-то один.
//
// На 429 отступает ВЕСЬ кабинет, а не только неудачливый запрос: иначе
// очередь продолжила бы долбить лимит, пока один вызов ждёт своей повторной
// попытки, и отступление не помогло бы никому.

/** 2 запроса в секунду — это 500 мс; берём с запасом на дрожание сети. */
const MIN_INTERVAL_MS = 520;
const MAX_RETRIES = 4;
/** Потолок отступления: ждать дольше бессмысленно, лямбда всё равно кончится. */
const MAX_BACKOFF_MS = 8000;

interface Lane {
  /** Очередь за разрешением. Держит только выдачу слота, а не сам запрос. */
  gate: Promise<unknown>;
  /** Время, раньше которого кабинету запрещено начинать следующий запрос. */
  nextAt: number;
}

const lanes = new Map<string, Lane>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * Взять разрешение на старт. Ждём в очереди только за разрешением: сам запрос
 * потом идёт параллельно с чужими. Ограничение у Ozon на ЧАСТОТУ, а не на
 * число одновременных — если сериализовать целиком, десять страниц по шесть
 * секунд превращаются в минуту и лямбда умирает раньше ответа.
 */
function acquire(lane: Lane): Promise<void> {
  const turn = lane.gate.then(async () => {
    const wait = lane.nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    lane.nextAt = Math.max(Date.now(), lane.nextAt) + MIN_INTERVAL_MS;
  });
  lane.gate = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Ozon 429 переживший все попытки — не повод показывать человеку сырой JSON. */
export class OzonRateLimitError extends Error {
  constructor() {
    super("Ozon держит лимит в 2 запроса в секунду и не пропустил запрос даже после нескольких попыток. Подождите минуту и повторите.");
    this.name = "OzonRateLimitError";
  }
}

/**
 * Запрос к Seller API через общую очередь кабинета.
 * @param clientId Client-Id кабинета — по нему Ozon и считает лимит.
 */
export async function ozonSellerFetch(
  clientId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const key = clientId.trim() || "unknown";
  const lane = lanes.get(key) ?? { gate: Promise.resolve(), nextAt: 0 };
  lanes.set(key, lane);

  for (let attempt = 0; ; attempt += 1) {
    await acquire(lane);
    const response = await fetch(url, init);
    if (response.status !== 429) return response;

    // Тело читаем, чтобы соединение не осталось висеть.
    await response.text().catch(() => "");
    if (attempt >= MAX_RETRIES) throw new OzonRateLimitError();

    const backoff = retryAfterMs(response) ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    // Отступает весь кабинет: иначе очередь продолжит долбить лимит, пока один
    // вызов ждёт повтора, и отступление не поможет никому.
    lane.nextAt = Math.max(lane.nextAt, Date.now() + backoff);
  }
}
