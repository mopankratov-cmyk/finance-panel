import { supabase } from "@/lib/supabase";

const TTL_HOURS = 24;

export function cacheKey(parts: string[]): string {
  return parts.join(":");
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const { data, error } = await supabase
      .from("wb_cache")
      .select("data, cached_at")
      .eq("key", key)
      .single();
    if (error || !data) return null;
    const age = Date.now() - new Date(data.cached_at).getTime();
    if (age > TTL_HOURS * 60 * 60 * 1000) return null;
    return data.data as T;
  } catch {
    return null;
  }
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
