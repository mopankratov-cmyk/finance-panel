import { getCachedBatch, getCachedWithMeta, setCache } from "./cache";

const ROWS_PER_PART = 500;

interface ArrayMeta {
  type: "array";
  parts: number;
}

function metaKey(key: string): string {
  return `${key}__meta`;
}

function partKey(key: string, index: number): string {
  return `${key}__part_${index}`;
}

export async function setLargeCache<T>(key: string, value: T[]): Promise<boolean> {
  if (value.length === 0) {
    return setCache(key, value);
  }

  if (value.length <= ROWS_PER_PART) {
    return setCache(key, value);
  }

  const parts = Math.ceil(value.length / ROWS_PER_PART);
  for (let i = 0; i < parts; i++) {
    const slice = value.slice(i * ROWS_PER_PART, (i + 1) * ROWS_PER_PART);
    const ok = await setCache(partKey(key, i), slice);
    if (!ok) return false;
  }

  return setCache(metaKey(key), { type: "array", parts } satisfies ArrayMeta);
}

export async function getLargeCacheWithMeta<T>(
  key: string,
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const meta = await getCachedWithMeta<ArrayMeta>(metaKey(key));
  if (meta?.data?.type === "array" && meta.data.parts > 0) {
    const partKeys = Array.from({ length: meta.data.parts }, (_, i) =>
      partKey(key, i),
    );
    const batch = await getCachedBatch<T[]>(partKeys);
    const cached_at = [...batch.values()].reduce(
      (max, p) => (p.cached_at > max ? p.cached_at : max),
      meta.cached_at,
    );
    const data = partKeys.flatMap((k) => batch.get(k)?.data ?? []);
    if (data.length === 0) return undefined;
    return { data, cached_at };
  }

  const direct = await getCachedWithMeta<T[]>(key);
  if (direct) return direct;
  return undefined;
}

export async function getLargeCache<T>(key: string): Promise<T[] | null> {
  const entry = await getLargeCacheWithMeta<T>(key);
  return entry?.data ?? null;
}
