import { createHmac, timingSafeEqual } from "crypto";

// HMAC-подпись URL медиа-прокси (img-proxy / media-proxy / yandex-img).
// Зачем: эти роуты намеренно публичны (их URL отдаётся внешним рендерам FAL/Seedance,
// которые фетчат сервер-сайд без нашей куки). Без подписи они — открытый image/video-релей
// и SSRF-плацдарм. Подпись + TTL делают так, что годен только URL, выпущенный нами, и не вечно.
//
// Секрет: SIGN_SECRET (приоритет) → AUTH_SECRET (уже прод-инвариант сессий) → dev-дефолт.
// В проде ОБЯЗАН быть задан хотя бы AUTH_SECRET, иначе подпись на небезопасном дефолте.

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 дней — переживает долгие/ретраящиеся джобы завода

function secret(): string {
  return process.env.SIGN_SECRET || process.env.AUTH_SECRET || "dev-insecure-secret-change-me-finance-panel";
}

// Канонический payload для HMAC: pathname + отсортированные query-параметры (без sig, но с exp).
// URLSearchParams.toString() даёт детерминированную кодировку на обеих сторонах, поэтому подпись
// устойчива к тому, что внешний фетчер нормализует '+'/'%20' или порядок параметров.
function canonical(pathname: string, params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([k]) => k !== "sig").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pathname + "?" + new URLSearchParams(entries).toString();
}

function hmac(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Подписать относительный путь прокси (напр. "/api/lab/yandex-img?path=...&key=...").
// Возвращает тот же путь с добавленными &exp=<epoch_sec>&sig=<base64url>.
export function signProxyUrl(pathAndQuery: string, ttlSec: number = DEFAULT_TTL_SEC): string {
  const u = new URL(pathAndQuery, "https://sign.local");
  u.searchParams.delete("sig");
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSec));
  u.searchParams.set("exp", String(exp));
  const sig = hmac(canonical(u.pathname, u.searchParams));
  u.searchParams.set("sig", sig);
  return u.pathname + "?" + u.searchParams.toString();
}

// Проверить подпись входящего запроса. false при любом отсутствующем/битом/просроченном поле.
export function verifyProxySig(params: URLSearchParams, pathname: string): boolean {
  const sig = params.get("sig");
  const exp = params.get("exp");
  if (!sig || !exp) return false;
  const expSec = Number(exp);
  if (!Number.isFinite(expSec) || expSec < Math.floor(Date.now() / 1000)) return false; // нет exp / просрочен
  const expected = hmac(canonical(pathname, params));
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
