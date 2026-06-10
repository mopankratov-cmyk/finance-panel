import { getCachedWithMeta, setCache } from "./cache";

/** Один gzip-blob через setCache — без сотен мелких upsert */
export async function setLargeCache<T>(key: string, value: T[]): Promise<boolean> {
  return setCache(key, value);
}

export async function getLargeCacheWithMeta<T>(
  key: string,
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const direct = await getCachedWithMeta<T[]>(key);
  if (direct && direct.data.length > 0) return direct;
  return undefined;
}

export async function getLargeCache<T>(key: string): Promise<T[] | null> {
  const entry = await getLargeCacheWithMeta<T>(key);
  return entry?.data ?? null;
}
