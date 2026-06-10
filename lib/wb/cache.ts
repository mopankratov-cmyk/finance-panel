import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export function cacheKey(parts: string[]): string {
  return parts.join(":");
}

export interface CachedEntry<T> {
  data: T;
  cached_at: string;
}

function db() {
  return getSupabaseAdmin() ?? supabase;
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
    const { data, error } = await db()
      .from("wb_cache")
      .select("key, data, cached_at")
      .in("key", keys);
    if (error) {
      console.error("[wb_cache] read failed:", error.message);
      return map;
    }
    if (!data) return map;

    for (const row of data) {
      map.set(row.key, {
        data: row.data as T,
        cached_at: row.cached_at,
      });
    }
  } catch (err) {
    console.error("[wb_cache] read error:", err);
  }
  return map;
}

export async function setCache<T>(key: string, value: T): Promise<boolean> {
  try {
    const { error } = await db()
      .from("wb_cache")
      .upsert(
        {
          key,
          data: value,
          cached_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    if (error) {
      console.error("[wb_cache] write failed:", key, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[wb_cache] write error:", key, err);
    return false;
  }
}
