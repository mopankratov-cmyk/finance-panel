import type { WbApiResponse } from "./types";

const WB_TOKEN_STATISTICS = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
const WB_TOKEN_ADVERT = process.env.WB_TOKEN_ADVERT;
const TIMEOUT_MS = 60_000;
const RETRY_STATUSES = [502, 503, 504];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export const WB_FETCH_REVALIDATE = 3600;

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
  /** Обойти Next.js Data Cache (кнопка «Обновить») */
  refresh?: boolean;
  /** Явный токен (кабинет из wb_cabinets) — в обход ENV-токена по умолчанию */
  token?: string;
}

export async function wbFetch<T>(
  url: string,
  options: RequestInit = {},
  fetchOptions: WbFetchOptions = {},
): Promise<WbApiResponse<T>> {
  const timestamp = new Date().toISOString();
  const token = fetchOptions.token || getWbToken(url);

  if (!token) {
    const envName = tokenEnvName(url);
    return {
      data: null,
      error: `${envName} не настроен. Добавьте токен в .env.local`,
      timestamp,
    };
  }

  const cacheInit: RequestInit = fetchOptions.refresh
    ? { cache: "no-store" }
    : { next: { revalidate: WB_FETCH_REVALIDATE } };

  try {
    const res = await fetchWithRetry(url, {
      ...options,
      ...cacheInit,
      headers: { Authorization: token, "Content-Type": "application/json", ...options.headers },
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
