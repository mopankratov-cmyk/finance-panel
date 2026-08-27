import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import {
  resolveOzonScopeDescriptor,
  type OzonCabinetScopeDescriptor,
} from "@/lib/ozon/cabinet";
import { loadOzonCockpit, type OzonCockpitView } from "@/lib/ozon/cockpit";
import { resolveOzonPeriod } from "@/lib/ozon/period";

export const OZON_COCKPIT_CACHE_SECONDS = 60 * 60;
export const OZON_COCKPIT_CACHE_VERSION = "v5";
const OZON_COCKPIT_RELIABILITY_VERSION = "complete-sales-v1";

export interface OzonCockpitCacheRequest {
  view: OzonCockpitView;
  scope: OzonCabinetScopeDescriptor;
  /** Длина периода в днях. Работает как запасной вариант, если дат нет. */
  days: number;
  taxPct: number;
  /** Явные границы периода из календаря. Без них — последние `days` дней. */
  from?: string;
  to?: string;
}

type OzonCockpitSnapshot = Awaited<ReturnType<typeof loadOzonCockpit>>;

export interface OzonCockpitCacheOptions {
  forceRefresh?: boolean;
  backgroundRefresh?: boolean;
}

export const OZON_COCKPIT_BACKGROUND_REFRESH = { backgroundRefresh: true } as const;

export function ozonCockpitRevalidationProfile(
  options: OzonCockpitCacheOptions,
): "max" | { expire: 0 } | null {
  if (options.backgroundRefresh) return "max";
  if (options.forceRefresh) return { expire: 0 };
  return null;
}

export function normalizeOzonCacheRequest(input: OzonCockpitCacheRequest): OzonCockpitCacheRequest {
  const period = resolveOzonPeriod(input.from, input.to, input.days);
  return {
    view: input.view,
    scope: {
      mode: input.scope.mode,
      label: input.scope.label.trim(),
      cabinetIds: [...new Set(input.scope.cabinetIds)].filter(Boolean).sort(),
    },
    // Ключ кэша держит КОНКРЕТНЫЕ даты, а не число дней: снимок «за 14 дней»,
    // снятый вчера, — это другой период, и отдавать его сегодня нельзя.
    days: period.days,
    from: period.from,
    to: period.to,
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
  options: OzonCockpitCacheOptions = {},
) {
  const normalized = normalizeOzonCacheRequest(input);
  const identity = ozonCockpitCacheIdentity(normalized);
  const tag = ozonCockpitCacheTag(normalized);
  const revalidationProfile = ozonCockpitRevalidationProfile(options);
  if (revalidationProfile) revalidateTag(tag, revalidationProfile);

  // Ключ общего снимка — тот же отпечаток, что и метка кэша Next.
  const sharedKey = tag.slice("ozon-cockpit:".length);

  const build = async () => {
    const scope = await resolveOzonScopeDescriptor(normalized.scope);
    if (!scope) throw new Error("Ozon-кабинеты для снимка больше недоступны");
    const period = resolveOzonPeriod(normalized.from, normalized.to, normalized.days);
    const data = await loadOzonCockpit(normalized.view, scope, period, normalized.taxPct);
    const encoded = encodeCompressedJson(data);
    // Кладём снимок в базу: кэш Next виден только своему экземпляру функции и
    // пропадает при деплое, поэтому ночной прогрев не доставался пользователю.
    const db = getSupabaseAdmin();
    if (db) {
      await db
        .from("ozon_cockpit_cache")
        .upsert({ cache_key: sharedKey, payload: encoded, generated_at: new Date().toISOString() }, { onConflict: "cache_key" });
    }
    return encoded;
  };

  const loadSnapshot = unstable_cache(
    async () => {
      // Свежий общий снимок избавляет от пересчёта: на кабинете с 88
      // артикулами он стоил 21 секунду.
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db
          .from("ozon_cockpit_cache")
          .select("payload, generated_at")
          .eq("cache_key", sharedKey)
          .maybeSingle();
        const generatedAt = data?.generated_at ? Date.parse(String(data.generated_at)) : 0;
        const fresh = generatedAt > 0 && Date.now() - generatedAt < OZON_COCKPIT_CACHE_SECONDS * 1000;
        if (fresh && typeof data?.payload === "string") return data.payload;
      }
      return build();
    },
    [
      `ozon-cockpit-snapshot-${OZON_COCKPIT_CACHE_VERSION}-compressed`,
      OZON_COCKPIT_RELIABILITY_VERSION,
      identity,
    ],
    { revalidate: OZON_COCKPIT_CACHE_SECONDS, tags: [tag] },
  );
  return decodeCompressedJson<OzonCockpitSnapshot>(await loadSnapshot());
}
