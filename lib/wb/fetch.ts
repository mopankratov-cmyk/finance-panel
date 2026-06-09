import { getCached, setCache, cacheKey } from "./cache";
import type { WbApiResponse } from "./types";

const WB_TOKEN = process.env.WB_API_TOKEN;
const TIMEOUT_MS = 60000;

export function wbHeaders(): HeadersInit {
  return {
    Authorization: WB_TOKEN ?? "",
    "Content-Type": "application/json",
  };
}

export async function wbFetch<T>(
  url: string,
  options: RequestInit = {},
  cacheParts?: string[],
): Promise<WbApiResponse<T>> {
  const timestamp = new Date().toISOString();
  if (!WB_TOKEN) {
    return {
      data: null,
      error: "WB_API_TOKEN не настроен. Добавьте токен в .env.local",
      timestamp,
    };
  }
  const key = cacheParts ? cacheKey(cacheParts) : null;
  if (key) {
    const cached = await getCached<T>(key);
    if (cached) {
      return { data: cached, error: null, timestamp };
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      ...options,
      headers: { ...wbHeaders(), ...options.headers },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text();
      return {
        data: null,
        error: `WB API ${res.status}: ${text.slice(0, 200)}`,
        timestamp,
      };
    }
    const data = (await res.json()) as T;
    if (key) await setCache(key, data);
    return { data, error: null, timestamp };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
    const isTimeout = msg.includes("abort") || msg.includes("AbortError");
    return {
      data: null,
      error: isTimeout ? "WB API не ответил за 60 секунд. Попробуйте позже." : msg,
      timestamp,
    };
  }
}
