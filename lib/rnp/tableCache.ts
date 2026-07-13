import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import { buildRnpTable, type RnpTable } from "@/lib/rnp/buildTable";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const WB_RNP_CACHE_SECONDS = 60 * 60;
export const WB_RNP_CACHE_VERSION = "v3";

export interface WbRnpCacheRequest {
  from: string;
  to: string;
  cabinetId: string | null;
  label?: string;
}

export function wbRnpCacheIdentity(input: WbRnpCacheRequest): string {
  return JSON.stringify({
    from: input.from,
    to: input.to,
    cabinetId: input.cabinetId,
    label: input.label?.trim() || "Все кабинеты",
  });
}

export function wbRnpCacheTag(input: WbRnpCacheRequest): string {
  const digest = createHash("sha256").update(wbRnpCacheIdentity(input)).digest("hex").slice(0, 32);
  return `wb-rnp:${digest}`;
}

export async function loadCachedWbRnp(
  input: WbRnpCacheRequest,
  options: { forceRefresh?: boolean } = {},
) {
  const identity = wbRnpCacheIdentity(input);
  const tag = wbRnpCacheTag(input);
  if (options.forceRefresh) revalidateTag(tag, { expire: 0 });
  const loadSnapshot = unstable_cache(
    async () => {
      const result = await buildRnpTable(input.from, input.to, input.cabinetId, input.label);
      if ("error" in result) throw new Error(result.error);
      return encodeCompressedJson(result);
    },
    [`wb-rnp-snapshot-${WB_RNP_CACHE_VERSION}-compressed`, identity],
    { revalidate: WB_RNP_CACHE_SECONDS, tags: [tag] },
  );
  return decodeCompressedJson<RnpTable>(await loadSnapshot());
}

export async function listWbRnpScopes(): Promise<Array<{ cabinetId: string | null; label: string }>> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("wb_cabinets")
    .select("id, name")
    .eq("marketplace", "wb")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const cabinets = (data ?? []).map((cabinet) => ({ cabinetId: String(cabinet.id), label: String(cabinet.name || "WB") }));
  return [{ cabinetId: null, label: "Все кабинеты" }, ...cabinets];
}

export function currentMoscowMonth(now = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from, to };
}
