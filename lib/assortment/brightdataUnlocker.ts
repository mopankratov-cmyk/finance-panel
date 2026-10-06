/**
 * Bright Data Web Unlocker (`POST /request`) — только для «Залетает в соцсетях» (решение владельца 06.10.2026: Instagram Reels,
 * Zara и Uniqlo, раз в неделю). Отдельно от lib/assortment/brightdata.ts: тот модуль — готовые наборы и сборщики, анлокера в нём нет
 * (тест tests/assortment-brightdata.test.mts). Здесь — короткий белый список адресов: публичные страницы Instagram без входа
 * (тема /popular/, рилс, пост, профиль), выдача Google по Instagram и карточка товара Zara/Uniqlo по номеру из подписи. Любой другой
 * адрес — отказ до запроса. Ответ — текст страницы (markdown) или JSON выдачи; картинки не скачиваются, цены дальше разбора не уходят.
 *
 * Как отвечает /request (живые ответы 06.10, tests/fixtures/assortment-social/responses.json):
 * - сбой цели — HTTP 200 с ПУСТЫМ телом и заголовками x-brd-error-code (proxy_timeout, captcha) и x-brd-status-code 502: временный сбой;
 * - неверная зона — HTTP 400 «zone "…" not found»: ошибка настройки, прогон останавливается;
 * - 401/403 — ключ; 402 и «Customer is not active» / баланс — деньги: прогон останавливается одной причиной;
 * - 429, 5xx, таймаут, обрыв сети — временный сбой этого запроса, прогон идёт дальше.
 */

const ENDPOINT = "https://api.brightdata.com/request";
export const DEFAULT_UNLOCKER_ZONE = "mcp_unlocker";
/** Страницы приходят за 4–20 с (карточка Zara — 20 с); 30 с впритык. */
export const UNLOCKER_TIMEOUT_MS = 60_000;

export type UnlockerFormat = "markdown" | "parsed_light";

export interface UnlockerConfig {
  token: string | null;
  zone: string;
}

/** Ключ и зона из окружения. Значения наружу не уходят — только факт «есть / нет». */
export function unlockerConfig(env: Record<string, string | undefined> = process.env): UnlockerConfig {
  return {
    token: env.BRIGHTDATA_API_TOKEN?.trim() || null,
    zone: env.BRIGHTDATA_UNLOCKER_ZONE?.trim() || DEFAULT_UNLOCKER_ZONE,
  };
}

/** Почему дальше идти бессмысленно: ключ, деньги, настройка зоны. Отдельные рилсы при этом неудачными не считаются. */
export class UnlockerStopError extends Error {
  constructor(message: string, readonly code: "auth" | "billing" | "config") {
    super(message);
    this.name = "UnlockerStopError";
  }
}

/** Остановка прогона? По имени и коду, а не только instanceof: класс может прийти из второй копии модуля (ESM и CJS в тестах). */
export function isUnlockerStop(error: unknown): error is UnlockerStopError {
  if (error instanceof UnlockerStopError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return error instanceof Error && error.name === "UnlockerStopError" && (code === "auth" || code === "billing" || code === "config");
}

/** Адрес вне белого списка — ошибка кода, а не сбой сети: запрос не уходит. */
export class UnlockerUrlError extends Error {}

export type UnlockerResult =
  | { ok: true; body: string; ms: number }
  | { ok: false; kind: "transient" | "failed"; reason: string; ms: number };

const INSTAGRAM_HOSTS = new Set(["www.instagram.com", "instagram.com"]);
/** Служебные разделы Instagram, которые профилем не являются. */
const INSTAGRAM_RESERVED = new Set(["accounts", "explore", "stories", "direct", "reels", "legal", "web", "about", "developer", "popular", "reel", "p", "tv"]);

/**
 * Белый список: тема /popular/<slug>/, /reel/<код>/, /p/<код>/, профиль /<ник>/, Google /search, карточка Zara US по p-коду,
 * карточка Uniqlo es/uk/us по E-коду. Только https, без логина и пароля в адресе.
 */
export function isAllowedUnlockerUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const path = url.pathname;
  if (INSTAGRAM_HOSTS.has(url.hostname)) {
    if (/^\/popular\/[^/]+\/?$/.test(path)) return true;
    if (/^\/(?:reel|p)\/[A-Za-z0-9_-]{5,40}\/?$/.test(path)) return true;
    const profile = /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(path);
    return Boolean(profile && !INSTAGRAM_RESERVED.has(profile[1].toLowerCase()));
  }
  if (url.hostname === "www.google.com") return path === "/search" && url.searchParams.has("q");
  if (url.hostname === "www.zara.com") return /^\/us\/en\/[a-z0-9-]+-p\d{8}\.html$/.test(path);
  if (url.hostname === "www.uniqlo.com") return /^\/(?:es|uk|us)\/en\/products\/E\d{6}-\d{3}\/\d{2}$/.test(path);
  return false;
}

/** Адрес выдачи Google: английский интерфейс, страна выдачи задана (без gl — случайная страна выхода прокси и капча, 06.10). */
export function googleSearchUrl(query: string, options: { gl?: string; num?: number } = {}): string {
  const params = new URLSearchParams({ q: query, hl: "en", num: String(options.num ?? 20), gl: options.gl ?? "us" });
  return `https://www.google.com/search?${params.toString()}&brd_json=1`;
}

function stopFor(status: number, text: string): UnlockerStopError | null {
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (status === 402 || /customer is not active|insufficient (?:funds|balance)|balance is (?:too )?low|payment required|billing/i.test(text)) {
    return new UnlockerStopError(`Bright Data: аккаунт не активен или нет средств (${status}${snippet ? `: ${snippet}` : ""})`, "billing");
  }
  if (status === 401 || status === 403) return new UnlockerStopError(`Bright Data не принял ключ (${status})`, "auth");
  if (status === 400 && /zone .*not found|zone .*(?:disabled|inactive)|invalid zone/i.test(text)) {
    return new UnlockerStopError(`Bright Data: зона анлокера не найдена — проверьте BRIGHTDATA_UNLOCKER_ZONE (${snippet})`, "config");
  }
  return null;
}

/**
 * Одна страница через Web Unlocker. Остановки (ключ, деньги, зона) — исключение UnlockerStopError; сбой одной страницы — результат
 * `{ ok: false }`: `transient` (повторить можно: прокси, капча, 429, 5xx, таймаут), `failed` (повторять бессмысленно: 404 цели, прочие 4xx).
 */
export async function unlockerFetch(
  url: string,
  format: UnlockerFormat,
  options: { config: UnlockerConfig; fetchImpl?: typeof fetch; timeoutMs?: number; nowMs?: () => number },
): Promise<UnlockerResult> {
  if (!isAllowedUnlockerUrl(url)) throw new UnlockerUrlError(`Адрес вне белого списка анлокера: ${url.slice(0, 120)}`);
  if (!options.config.token) throw new UnlockerStopError("Ключ Bright Data не задан (BRIGHTDATA_API_TOKEN)", "config");
  const clock = options.nowMs ?? Date.now;
  const started = clock();
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, zone: options.config.zone, format: "raw", data_format: format }),
      signal: AbortSignal.timeout(options.timeoutMs ?? UNLOCKER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const reason = name === "TimeoutError" || name === "AbortError" ? "таймаут запроса" : `сеть: ${error instanceof Error ? error.message.slice(0, 120) : "обрыв"}`;
    return { ok: false, kind: "transient", reason, ms: clock() - started };
  }
  const text = await response.text().catch(() => "");
  const ms = clock() - started;
  if (!response.ok) {
    const stop = stopFor(response.status, text);
    if (stop) throw stop;
    if (response.status === 429 || response.status >= 500 || response.status === 408) return { ok: false, kind: "transient", reason: `Bright Data ответил ${response.status}`, ms };
    return { ok: false, kind: "failed", reason: `Bright Data ответил ${response.status}: ${text.replace(/\s+/g, " ").slice(0, 120)}`, ms };
  }
  // 200 ещё не успех: сбой цели приходит с заголовками x-brd-* и пустым телом.
  const errorCode = response.headers.get("x-brd-error-code");
  const targetStatus = Number(response.headers.get("x-brd-status-code") ?? "") || null;
  if (errorCode) {
    const why = response.headers.get("x-brd-error") ?? "";
    // Деньги и ключ бывают и здесь — тогда прогон стоп.
    const stop = stopFor(0, `${errorCode} ${why}`);
    if (stop && stop.code === "billing") throw stop;
    return { ok: false, kind: "transient", reason: `сбой страницы: ${errorCode}${why ? ` (${why.slice(0, 80)})` : ""}`, ms };
  }
  if (targetStatus === 404 || targetStatus === 410) return { ok: false, kind: "failed", reason: `страницы нет (${targetStatus})`, ms };
  if (targetStatus != null && targetStatus >= 500) return { ok: false, kind: "transient", reason: `сайт ответил ${targetStatus}`, ms };
  if (!text.trim()) return { ok: false, kind: "transient", reason: "пустой ответ", ms };
  return { ok: true, body: text, ms };
}
