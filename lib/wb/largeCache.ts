import { gunzipSync, gzipSync } from "node:zlib";
import { getCachedBatch, getCachedWithMeta, setCache } from "./cache";

/** PostgREST from this host times out above ~13KB per request body */
const MAX_PART_CHARS = 8_000;
/** Batch GET responses also time out above ~13KB total */
const READ_CHUNK = 1;

interface LargeMeta {
  __large: true;
  parts: number;
}

interface LegacyMeta {
  type: "array";
  parts: number;
}

interface PartPayload {
  __part: true;
  data: string;
}

interface CompressedPayload {
  __compressed: true;
  data: string;
}

function partKey(base: string, index: number): string {
  return `${base}:part:${index}`;
}

function legacyPartKey(base: string, index: number): string {
  return `${base}__part_${index}`;
}

function metaKey(base: string): string {
  return `${base}:meta`;
}

function legacyMetaKey(base: string): string {
  return `${base}__meta`;
}

function decodeGzipBase64<T>(gz: string): T[] {
  const json = gunzipSync(Buffer.from(gz, "base64")).toString("utf8");
  return JSON.parse(json) as T[];
}

function decodeStoredRows<T>(raw: unknown): T[] | null {
  if (Array.isArray(raw) && raw.length > 0) return raw as T[];
  if (
    typeof raw === "object" &&
    raw !== null &&
    "__compressed" in raw &&
    (raw as CompressedPayload).__compressed
  ) {
    return decodeGzipBase64<T>((raw as CompressedPayload).data);
  }
  return null;
}

async function readPartsBatched<T>(
  partKeys: string[],
): Promise<Map<string, { data: unknown; cached_at: string }>> {
  const map = new Map<string, { data: unknown; cached_at: string }>();
  for (let i = 0; i < partKeys.length; i += READ_CHUNK) {
    const slice = partKeys.slice(i, i + READ_CHUNK);
    const batch = await getCachedBatch<unknown>(slice);
    for (const [k, v] of batch) map.set(k, v);
  }
  return map;
}

/** Gzip + split into small REST-safe parts when needed */
export async function setLargeCache<T>(key: string, value: T[]): Promise<boolean> {
  const gz = gzipSync(Buffer.from(JSON.stringify(value))).toString("base64");

  if (gz.length <= MAX_PART_CHARS) {
    return setCache(key, { __compressed: true, data: gz } satisfies CompressedPayload);
  }

  const partCount = Math.ceil(gz.length / MAX_PART_CHARS);
  const okMeta = await setCache(metaKey(key), {
    __large: true,
    parts: partCount,
  } satisfies LargeMeta);
  if (!okMeta) return false;

  for (let i = 0; i < partCount; i++) {
    const slice = gz.slice(i * MAX_PART_CHARS, (i + 1) * MAX_PART_CHARS);
    const ok = await setCache(partKey(key, i), {
      __part: true,
      data: slice,
    } satisfies PartPayload);
    if (!ok) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
  return true;
}

async function readGzipParts<T>(
  partKeys: string[],
  cached_at: string,
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const parts = await readPartsBatched<PartPayload>(partKeys);
  let gz = "";
  let latest = cached_at;
  for (const pk of partKeys) {
    const entry = parts.get(pk);
    if (!entry) return undefined;
    const payload = entry.data as PartPayload;
    if (!payload?.__part) return undefined;
    gz += payload.data;
    if (entry.cached_at > latest) latest = entry.cached_at;
  }
  return { data: decodeGzipBase64<T>(gz), cached_at: latest };
}

async function readLegacyParts<T>(
  baseKey: string,
  partCount: number,
  cached_at: string,
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const partKeys = Array.from({ length: partCount }, (_, i) =>
    legacyPartKey(baseKey, i),
  );
  const parts = await readPartsBatched<unknown>(partKeys);
  const data: T[] = [];
  for (const pk of partKeys) {
    const entry = parts.get(pk);
    const rows = entry ? decodeStoredRows<T>(entry.data) : null;
    if (rows?.length) data.push(...rows);
  }
  if (data.length === 0) return undefined;
  return { data, cached_at };
}

export async function getLargeCacheWithMeta<T>(
  key: string,
): Promise<{ data: T[]; cached_at: string } | undefined> {
  const direct = await getCachedWithMeta<unknown>(key);
  if (direct) {
    const rows = decodeStoredRows<T>(direct.data);
    if (rows?.length) return { data: rows, cached_at: direct.cached_at };
  }

  const metaBatch = await getCachedBatch<LargeMeta | LegacyMeta>([
    metaKey(key),
    legacyMetaKey(key),
  ]);
  const newMeta = metaBatch.get(metaKey(key));
  if (newMeta?.data && "__large" in newMeta.data && newMeta.data.parts > 0) {
    const partKeys = Array.from({ length: newMeta.data.parts }, (_, i) =>
      partKey(key, i),
    );
    return readGzipParts<T>(partKeys, newMeta.cached_at);
  }

  const legacyMeta = metaBatch.get(legacyMetaKey(key));
  if (legacyMeta?.data && "type" in legacyMeta.data && legacyMeta.data.parts > 0) {
    return readLegacyParts<T>(key, legacyMeta.data.parts, legacyMeta.cached_at);
  }

  return undefined;
}

export async function getLargeCache<T>(key: string): Promise<T[] | null> {
  const entry = await getLargeCacheWithMeta<T>(key);
  return entry?.data ?? null;
}
