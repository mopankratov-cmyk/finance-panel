import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";

export const HOURLY_DASHBOARD_CACHE_SECONDS = 60 * 60;
export const HOURLY_DASHBOARD_CACHE_VERSION = "v1";

type CacheIdentity = Record<string, boolean | number | string | null | undefined>;

export function hourlyDashboardIdentity(input: CacheIdentity): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function hourlyDashboardTag(namespace: string, input: CacheIdentity): string {
  const digest = createHash("sha256").update(hourlyDashboardIdentity(input)).digest("hex").slice(0, 32);
  return `dashboard:${namespace}:${digest}`;
}

export async function loadHourlyDashboard<T>(
  namespace: string,
  identityInput: CacheIdentity,
  loader: () => Promise<T>,
  options: { forceRefresh?: boolean } = {},
): Promise<T> {
  const identity = hourlyDashboardIdentity(identityInput);
  const tag = hourlyDashboardTag(namespace, identityInput);
  if (options.forceRefresh) revalidateTag(tag, { expire: 0 });
  const loadSnapshot = unstable_cache(
    async () => encodeCompressedJson(await loader()),
    [`hourly-dashboard-${HOURLY_DASHBOARD_CACHE_VERSION}`, namespace, identity],
    { revalidate: HOURLY_DASHBOARD_CACHE_SECONDS, tags: [tag] },
  );
  return decodeCompressedJson<T>(await loadSnapshot());
}
