import { getCached, setCache, cacheKey } from "./cache";
import type { WbApiResponse } from "./types";

const WB_TOKEN = process.env.WB_API_TOKEN;

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
    const cached = getCached<T>(key);
    if (cached) {
      return { data: cached, error: null, timestamp };
    }
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...wbHeaders(), ...options.headers },
      next: { revalidate: 3600 },
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
    if (key) setCache(key, data);
    return { data, error: null, timestamp };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Неизвестная ошибка",
      timestamp,
    };
  }
}
