import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import { buildRnpTable, type RnpTable } from "@/lib/rnp/buildTable";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadCabinetPimRowsHourly } from "@/lib/wb/cards";

// Пользовательский экран должен читать last-good снимок, а не становиться
// холодным тяжёлым расчётом, если почасовой прогрев задержался из-за WB/БД.
// Семантические пересчёты метрик не меняют сериализованную форму снимка, поэтому
// не должны отрезать last-good ключ сразу после релиза. Версию меняем только при
// несовместимой форме данных; свежие значения обновляет тег фонового прогрева.
export const WB_RNP_CACHE_SECONDS = 12 * 60 * 60;
export const WB_RNP_CACHE_VERSION = "v12-net-buyouts";

export interface WbRnpCacheRequest {
  from: string;
  to: string;
  cabinetId: string | null;
  label?: string;
  turnoverWindowDays?: number;
}

export interface WbRnpCacheOptions {
  forceRefresh?: boolean;
  backgroundRefresh?: boolean;
}

export const WB_RNP_BACKGROUND_REFRESH = { backgroundRefresh: true } as const;

export function wbRnpRevalidationProfile(
  options: WbRnpCacheOptions,
): "max" | { expire: 0 } | null {
  if (options.backgroundRefresh) return "max";
  if (options.forceRefresh) return { expire: 0 };
  return null;
}

export function wbRnpCacheIdentity(input: WbRnpCacheRequest): string {
  return JSON.stringify({
    from: input.from,
    to: input.to,
    cabinetId: input.cabinetId,
    label: input.label?.trim() || "Все кабинеты",
    turnoverWindowDays: input.turnoverWindowDays ?? 30,
  });
}

export function wbRnpCacheTag(input: WbRnpCacheRequest): string {
  const digest = createHash("sha256").update(wbRnpCacheIdentity(input)).digest("hex").slice(0, 32);
  return `wb-rnp:${digest}`;
}

export async function loadCachedWbRnp(
  input: WbRnpCacheRequest,
  options: WbRnpCacheOptions = {},
) {
  const identity = wbRnpCacheIdentity(input);
  const tag = wbRnpCacheTag(input);
  const revalidationProfile = wbRnpRevalidationProfile(options);
  if (revalidationProfile) revalidateTag(tag, revalidationProfile);
  const loadSnapshot = unstable_cache(
    async () => {
      const result = await buildRnpTable(
        input.from,
        input.to,
        input.cabinetId,
        input.label,
        input.turnoverWindowDays ?? 30,
      );
      if ("error" in result) throw new Error(result.error);
      return encodeCompressedJson(result);
    },
    [`wb-rnp-snapshot-${WB_RNP_CACHE_VERSION}-compressed`, identity],
    { revalidate: WB_RNP_CACHE_SECONDS, tags: [tag] },
  );
  const snapshot = decodeCompressedJson<RnpTable>(await loadSnapshot());
  // Снимок без карточек WB (pim_cold): названия и бренды пустые. Прежний ход —
  // сброс ключа на каждом чтении — устроил вечную петлю: пока PIM холодный,
  // КАЖДОЕ открытие РНП пересобирало снимок с нуля (~8 секунд вместо тёплого
  // чтения). Теперь пользователь всегда получает готовый снимок сразу, а починка
  // идёт после ответа и только если снимок не свежесобранный: прогреваем PIM и
  // помечаем тег на фоновую пересборку (stale-while-revalidate), не чаще, чем
  // раз в 15 минут на срез.
  if (snapshot.pim_cold) {
    const ageMs = Date.now() - Date.parse(snapshot.generated_at || "");
    if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
      after(async () => {
        await loadCabinetPimRowsHourly(input.cabinetId).catch(() => []);
        revalidateTag(tag, "max");
      });
    }
  }
  return snapshot;
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
