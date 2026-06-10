import { gunzipSync, gzipSync } from "node:zlib";
import { Agent, request as httpsRequest } from "node:https";

const httpsAgent = new Agent({ keepAlive: true, maxSockets: 1 });
import { supabase } from "@/lib/supabase";

export function cacheKey(parts: string[]): string {
  return parts.join(":");
}

export interface CachedEntry<T> {
  data: T;
  cached_at: string;
}

interface CompressedPayload {
  __compressed: true;
  data: string;
}

interface CacheRow {
  key: string;
  data: unknown;
  cached_at: string;
}

const COMPRESS_THRESHOLD = 8_000;

function restConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isCompressed(value: unknown): value is CompressedPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "__compressed" in value &&
    (value as CompressedPayload).__compressed === true
  );
}

function encodeForStorage<T>(value: T): T | CompressedPayload {
  const json = JSON.stringify(value);
  if (json.length < COMPRESS_THRESHOLD) return value;
  return {
    __compressed: true,
    data: gzipSync(Buffer.from(json)).toString("base64"),
  };
}

function decodeFromStorage<T>(stored: unknown): T {
  if (!isCompressed(stored)) return stored as T;
  const json = gunzipSync(Buffer.from(stored.data, "base64")).toString("utf8");
  return JSON.parse(json) as T;
}

function httpsJson(
  method: string,
  path: string,
  cfg: { url: string; key: string },
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const endpoint = new URL(path, cfg.url);
  const payload = body ?? "";

  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        agent: httpsAgent,
        hostname: endpoint.hostname,
        path: `${endpoint.pathname}${endpoint.search}`,
        method,
        timeout: 60_000,
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          ...extraHeaders,
          ...(payload
            ? { "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 500;
          resolve({ ok: status >= 200 && status < 300, status, text });
        });
      },
    );
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, text: String(err) });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, text: "timeout" });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function restUpsert(key: string, payload: unknown): Promise<boolean> {
  const cfg = restConfig();
  if (!cfg) return false;

  const body = JSON.stringify({
    key,
    data: payload,
    cached_at: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    const res = await httpsJson(
      "POST",
      "/rest/v1/wb_cache?on_conflict=key",
      cfg,
      body,
      {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
    if (res.ok) return true;
    console.error(
      "[wb_cache] REST write failed:",
      key,
      res.status,
      res.text.slice(0, 200),
      `(${body.length} bytes)`,
    );
  }
  return false;
}

async function restSelect(keys: string[]): Promise<CacheRow[]> {
  const cfg = restConfig();
  if (!cfg || keys.length === 0) return [];

  const quoted = keys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
  const path = `/rest/v1/wb_cache?select=key,data,cached_at&key=in.(${quoted})`;

  const res = await httpsJson("GET", path, cfg);
  if (!res.ok) {
    console.error("[wb_cache] REST read failed:", res.status, res.text.slice(0, 200));
    return [];
  }
  try {
    return JSON.parse(res.text) as CacheRow[];
  } catch {
    return [];
  }
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

  const unique = [...new Set(keys)];

  if (restConfig()) {
    const CHUNK = 25;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const rows = await restSelect(unique.slice(i, i + CHUNK));
      for (const row of rows) {
        map.set(row.key, {
          data: decodeFromStorage<T>(row.data),
          cached_at: row.cached_at,
        });
      }
    }
    return map;
  }

  try {
    const { data, error } = await supabase
      .from("wb_cache")
      .select("key, data, cached_at")
      .in("key", unique);
    if (error || !data) return map;
    for (const row of data) {
      map.set(row.key, {
        data: decodeFromStorage<T>(row.data),
        cached_at: row.cached_at,
      });
    }
  } catch (err) {
    console.error("[wb_cache] read error:", err);
  }
  return map;
}

export async function setCache<T>(key: string, value: T): Promise<boolean> {
  const payload = encodeForStorage(value);

  if (restConfig()) {
    return restUpsert(key, payload);
  }

  try {
    const { error } = await supabase.from("wb_cache").upsert(
      { key, data: payload, cached_at: new Date().toISOString() },
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
