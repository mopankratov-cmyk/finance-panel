import { getCached, setCache, cacheKey } from "./cache";
import { getLargeCache, setLargeCache } from "./largeCache";
import type { WbApiResponse } from "./types";

const WB_TOKEN_STATISTICS = process.env.WB_TOKEN_STATISTICS;
const WB_TOKEN_ADVERT = process.env.WB_TOKEN_ADVERT;
const TIMEOUT_MS = 60000;
const RETRY_STATUSES = [502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isAdvertApi(url: string): boolean {
  try {
    return new URL(url).hostname === "advert-api.wildberries.ru";
  } catch {
    return false;
  }
}

function getWbToken(url: string): string | undefined {
  return isAdvertApi(url) ? WB_TOKEN_ADVERT : WB_TOKEN_STATISTICS;
}

function tokenEnvName(url: string): string {
  return isAdvertApi(url) ? "WB_TOKEN_ADVERT" : "WB_TOKEN_STATISTICS";
}

export function wbHeaders(url: string): HeadersInit {
  return {
    Authorization: getWbToken(url) ?? "",
    "Content-Type": "application/json",
  };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (RETRY_STATUSES.includes(res.status)) {
        lastError = new Error(`WB API ${res.status}`);
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error("Unknown error");
      if (lastError.message.includes("abort")) break;
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

export interface WbFetchOptions {
  /** Не читать кэш перед запросом (для cron/sync) */
  skipCacheRead?: boolean;
}

export async function wbFetch<T>(
  url: string,
  options: RequestInit = {},
  cacheParts?: string[],
  fetchOptions: WbFetchOptions = {},
): Promise<WbApiResponse<T>> {
  const timestamp = new Date().toISOString();
  const token = getWbToken(url);

  if (!token) {
    const envName = tokenEnvName(url);
    return {
      data: null,
      error: `${envName} не настроен. Добавьте токен в .env.local`,
      timestamp,
    };
  }

  const key = cacheParts ? cacheKey(cacheParts) : null;
  if (key && !fetchOptions.skipCacheRead) {
    const asLarge = await getLargeCache<unknown>(key);
    if (asLarge) {
      return { data: asLarge as T, error: null, timestamp };
    }
    const cached = await getCached<T>(key);
    if (cached) {
      return { data: cached, error: null, timestamp };
    }
  }

  try {
    const res = await fetchWithRetry(url, {
      ...options,
      headers: { ...wbHeaders(url), ...options.headers },
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        data: null,
        error: `WB API ${res.status}: ${text.slice(0, 200)}`,
        timestamp,
      };
    }

    const data = (await res.json()) as T;
    if (key) {
      if (Array.isArray(data)) {
        await setLargeCache(key, data);
      } else {
        await setCache(key, data);
      }
    }
    return { data, error: null, timestamp };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return {
      data: null,
      error: isTimeout
        ? "WB API не ответил за 60 секунд. Попробуйте позже."
        : msg,
      timestamp,
    };
  }
}
