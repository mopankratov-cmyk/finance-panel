import { supabase } from "@/lib/supabase";

export function cacheKey(parts: string[]): string {
  return parts.join(":");
}

export interface CachedEntry<T> {
  data: T;
  cached_at: string;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const entry = await getCachedWithMeta<T>(key);
  return entry?.data ?? null;
}

export async function getCachedWithMeta<T>(
  key: string,
): Promise<CachedEntry<T> | null> {
  const batch = await getCachedBatch<T>([key]);
  return batch.get(key) ?? null;
}

export async function getCachedBatch<T>(
  keys: string[],
): Promise<Map<string, CachedEntry<T>>> {
  const map = new Map<string, CachedEntry<T>>();
  if (keys.length === 0) return map;

  try {
    const { data, error } = await supabase
      .from("wb_cache")
      .select("key, data, cached_at")
      .in("key", keys);
    if (error || !data) return map;

    for (const row of data) {
      map.set(row.key, {
        data: row.data as T,
        cached_at: row.cached_at,
      });
    }
  } catch {
    // ignore
  }
  return map;
}

export async function setCache<T>(key: string, value: T): Promise<void> {
  try {
    await supabase.from("wb_cache").upsert({
      key,
      data: value,
      cached_at: new Date().toISOString(),
    });
  } catch {
    // ignore cache errors
  }
}
