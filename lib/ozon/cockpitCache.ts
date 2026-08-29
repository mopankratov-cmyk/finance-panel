import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { decodeCompressedJson, encodeCompressedJson } from "@/lib/cache/compressedJson";
import {
  resolveOzonScopeDescriptor,
  type OzonCabinetScopeDescriptor,
} from "@/lib/ozon/cabinet";
import { loadOzonCockpit, type OzonCockpitView } from "@/lib/ozon/cockpit";
import { resolveOzonPeriod } from "@/lib/ozon/period";

export const OZON_COCKPIT_CACHE_SECONDS = 60 * 60;

/**
 * Снимок считается свежим, пока не прошёл один шаг прогрева.
 *
 * Прогрев ходит каждые 15 минут, поэтому более старый снимок означает, что
 * прогрев по этому ключу либо не дошёл, либо ключ прогревом не покрыт.
 */
export const OZON_COCKPIT_FRESH_SECONDS = 15 * 60;

/**
 * Сколько живёт снимок в кэше самого экземпляра функции.
 *
 * Час здесь означал, что 15-минутный прогрев до пользователя не доезжает:
 * инстанс продолжал отдавать payload, прочитанный час назад. Минута —
 * компромисс: чтение одной строки из базы стоит десятки миллисекунд, а
 * свежий снимок доходит почти сразу.
 */
const OZON_COCKPIT_INSTANCE_SECONDS = 60;
export const OZON_COCKPIT_CACHE_VERSION = "v7"; // v7: источник рекламы выбирается по каждому кабинету — снимки с нулевым расходом недействительны
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

/**
 * Пересборки одного ключа, идущие прямо сейчас в этом экземпляре функции.
 *
 * Без этого набора десяток одновременных запросов холодного экрана запускал
 * десяток одинаковых сборок и вместе пробивал лимит Ozon в 2 запроса в
 * секунду. Разные экземпляры друг о друге по-прежнему не знают, но и они
 * теперь чаще попадают в уже готовый снимок, а не в собственную сборку.
 */
const rebuilding = new Map<string, Promise<string>>();

export function runOzonSnapshotOnce(key: string, build: () => Promise<string>): Promise<string> {
  const running = rebuilding.get(key);
  if (running) return running;
  const started = build().finally(() => rebuilding.delete(key));
  rebuilding.set(key, started);
  return started;
}

/** Пересборка после ответа: пользователь уже получил данные, ждать нечего. */
function scheduleBackgroundRebuild(key: string, build: () => Promise<string>) {
  if (rebuilding.has(key)) return;
  try {
    after(async () => {
      try {
        await runOzonSnapshotOnce(key, build);
      } catch (error) {
        console.error("[ozon-cockpit] фоновая пересборка не удалась:", error instanceof Error ? error.message : error);
      }
    });
  } catch {
    // after() доступен только внутри запроса. Вне его (прогрев из крона,
    // тесты) фоновая пересборка не нужна — там сборка и так синхронная.
  }
}

/**
 * Убрать из таблицы снимков то, что никому больше не понадобится.
 *
 * Ключ снимка содержит конкретные даты и версию логики, поэтому таблица растёт
 * без остановки: вчерашние периоды и снимки прежних версий не читает уже никто,
 * но они продолжают занимать место. Чистим по возрасту записи — переживший
 * сутки снимок протух в любом случае, его срок годности час.
 */
export async function pruneOzonSnapshotCache(maxAgeHours = 24): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - Math.max(1, maxAgeHours) * 3_600_000).toISOString();
  const { data, error } = await db
    .from("ozon_cockpit_cache")
    .delete()
    .lt("generated_at", cutoff)
    .select("cache_key");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
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
  // Версия — часть ключа и в базе: смена логики данных обязана
  // обесценивать НЕ только кэш инстанса, но и общий снимок, иначе
  // пользователь до часа смотрит на данные прежней логики (нулевую
  // рекламу после фикса источника — ровно это и случилось).
  const sharedKey = `${OZON_COCKPIT_CACHE_VERSION}:${tag.slice("ozon-cockpit:".length)}`;

  const build = async () => runOzonSnapshotOnce(sharedKey, async () => {
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
  });

  const loadSnapshot = unstable_cache(
    async () => {
      // Свежий общий снимок избавляет от пересчёта: на кабинете с 88
      // артикулами он стоил 21 секунду. Но когда вызывающий просит обновиться
      // (ночной прогрев, ручной пересчёт), читать снимок нельзя — иначе он
      // вернёт сам себя, и обновить его станет нечем до истечения срока.
      const db = revalidationProfile ? null : getSupabaseAdmin();
      if (db) {
        const { data } = await db
          .from("ozon_cockpit_cache")
          .select("payload, generated_at")
          .eq("cache_key", sharedKey)
          .maybeSingle();
        const generatedAt = data?.generated_at ? Date.parse(String(data.generated_at)) : 0;
        const ageMs = generatedAt > 0 ? Date.now() - generatedAt : Infinity;
        if (typeof data?.payload === "string" && ageMs < OZON_COCKPIT_CACHE_SECONDS * 1000) {
          // Лежалый, но пригодный снимок отдаём сразу, а пересобираем после
          // ответа: ждать двадцать-шестьдесят секунд перед немым скелетоном
          // человеку незачем — он смотрит на данные, которым несколько минут,
          // и видит их возраст в шапке.
          if (ageMs > OZON_COCKPIT_FRESH_SECONDS * 1000) scheduleBackgroundRebuild(sharedKey, build);
          return data.payload;
        }
      }
      return build();
    },
    [
      `ozon-cockpit-snapshot-${OZON_COCKPIT_CACHE_VERSION}-compressed`,
      OZON_COCKPIT_RELIABILITY_VERSION,
      identity,
    ],
    { revalidate: OZON_COCKPIT_INSTANCE_SECONDS, tags: [tag] },
  );
  // Повреждённая строка кэша не должна класть экран на весь срок годности:
  // раньше исключение из декодера уходило наружу как 502, а следующий запрос
  // получал ту же битую строку из кэша инстанса — и так до часа. Битый снимок
  // лечится единственным осмысленным способом: пересобрать заново.
  const decodeOrRebuild = async (encoded: string) => {
    try {
      return decodeCompressedJson<OzonCockpitSnapshot>(encoded);
    } catch (error) {
      console.error("[ozon-cockpit] снимок не читается, пересобираем:", error instanceof Error ? error.message : error);
      return decodeCompressedJson<OzonCockpitSnapshot>(await build());
    }
  };
  const snapshot = await decodeOrRebuild(await loadSnapshot());
  // unstable_cache отдаёт лежалую копию сразу, а перестраивает в фоне —
  // пользователь видел снимок шестичасовой давности как «текущий» (нулевую
  // рекламу при уже собранных данных). Старше срока годности не отдаём:
  // пересобираем синхронно.
  const generatedAt = Date.parse(String((snapshot as { generatedAt?: string }).generatedAt ?? ""));
  if (Number.isFinite(generatedAt) && Date.now() - generatedAt > OZON_COCKPIT_CACHE_SECONDS * 1000) {
    return await decodeOrRebuild(await build());
  }
  return snapshot;
}
