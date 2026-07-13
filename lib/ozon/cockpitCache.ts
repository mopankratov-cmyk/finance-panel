import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import {
  resolveOzonScopeDescriptor,
  type OzonCabinetScopeDescriptor,
} from "@/lib/ozon/cabinet";
import { loadOzonCockpit, type OzonCockpitView } from "@/lib/ozon/cockpit";

export const OZON_COCKPIT_CACHE_SECONDS = 60 * 60;

export interface OzonCockpitCacheRequest {
  view: OzonCockpitView;
  scope: OzonCabinetScopeDescriptor;
  days: number;
  taxPct: number;
}

type OzonCockpitSnapshot = Awaited<ReturnType<typeof loadOzonCockpit>>;

export function normalizeOzonCacheRequest(input: OzonCockpitCacheRequest): OzonCockpitCacheRequest {
  return {
    view: input.view,
    scope: {
      mode: input.scope.mode,
      label: input.scope.label.trim(),
      cabinetIds: [...new Set(input.scope.cabinetIds)].filter(Boolean).sort(),
    },
    days: Math.min(30, Math.max(7, Math.round(input.days))),
    taxPct: Math.min(30, Math.max(0, Math.round(input.taxPct * 100) / 100)),
  };
}

export function ozonCockpitCacheIdentity(input: OzonCockpitCacheRequest): string {
  return JSON.stringify(normalizeOzonCacheRequest(input));
}

export function ozonCockpitCacheTag(input: OzonCockpitCacheRequest): string {
  const digest = createHash("sha256").update(ozonCockpitCacheIdentity(input)).digest("hex").slice(0, 32);
  return `ozon-cockpit:${digest}`;
}

export async function loadCachedOzonCockpit(
  input: OzonCockpitCacheRequest,
  options: { forceRefresh?: boolean } = {},
) {
  const normalized = normalizeOzonCacheRequest(input);
  const identity = ozonCockpitCacheIdentity(normalized);
  const tag = ozonCockpitCacheTag(normalized);
  if (options.forceRefresh) revalidateTag(tag, { expire: 0 });

  const loadSnapshot = unstable_cache(
    async () => {
      const scope = await resolveOzonScopeDescriptor(normalized.scope);
      if (!scope) throw new Error("Ozon-кабинеты для снимка больше недоступны");
      const data = await loadOzonCockpit(normalized.view, scope, normalized.days, normalized.taxPct);
      return encodeCompressedJson(data);
    },
    ["ozon-cockpit-snapshot-v2-compressed", identity],
    { revalidate: OZON_COCKPIT_CACHE_SECONDS, tags: [tag] },
  );
  return decodeCompressedJson<OzonCockpitSnapshot>(await loadSnapshot());
}
