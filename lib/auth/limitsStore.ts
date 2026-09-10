import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_WAREHOUSE_LIMITS, type WarehouseLimits } from "./approvals";

/**
 * Чтение и запись порогов.
 *
 * Значения по умолчанию живут в коде (approvals.ts) — это те числа, которые
 * назвал владелец. Здесь только их переопределение: строка без организации —
 * лимиты компании, строка с организацией — лимиты внешнего клиента, который
 * задаёт их себе сам.
 *
 * Отсутствие строки и отсутствие таблицы дают ОДИН И ТОТ ЖЕ ответ —
 * умолчания. Иначе панель до применения миграции работала бы без порогов
 * вовсе: любая сумма проходила бы как «в пределах лимита», и это худший из
 * возможных отказов — тихий.
 */

const NUMBER_KEYS = ["discrepancyRub", "discrepancyShare", "writeOffPerDocRub", "writeOffPerMonthRub"] as const;

/** Слияние с умолчаниями: чужие ключи и мусор внутрь не проходят. */
export function mergeLimits(raw: unknown): WarehouseLimits {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const merged = { ...DEFAULT_WAREHOUSE_LIMITS };
  for (const key of NUMBER_KEYS) {
    const value = Number(source[key]);
    // Отрицательный порог — не «строже», а бессмыслица: он запретил бы всё,
    // включая нулевую сумму. Такое значение отбрасываем к умолчанию.
    if (Number.isFinite(value) && value >= 0) merged[key] = value;
  }
  // Доля больше единицы означала бы «сто с лишним процентов поставки» —
  // порог, который не сработает никогда.
  if (merged.discrepancyShare > 1) merged.discrepancyShare = DEFAULT_WAREHOUSE_LIMITS.discrepancyShare;
  return merged;
}

const missingTable = (message: string | undefined) =>
  /relation .*access_limits.* does not exist/i.test(message ?? "") || /access_limits/.test(message ?? "");

export async function loadLimits(organizationId: string | null): Promise<WarehouseLimits> {
  const db = getSupabaseAdmin();
  if (!db) return { ...DEFAULT_WAREHOUSE_LIMITS };
  const query = db.from("access_limits").select("limits").limit(1);
  const { data, error } = organizationId
    ? await query.eq("organization_id", organizationId).maybeSingle()
    : await query.is("organization_id", null).maybeSingle();
  if (error) {
    if (!missingTable(error.message)) console.error("[limits] не прочитаны", error.message);
    return { ...DEFAULT_WAREHOUSE_LIMITS };
  }
  return mergeLimits(data?.limits);
}

export async function saveLimits(
  organizationId: string | null,
  limits: WarehouseLimits,
  actorEmail: string | null,
): Promise<{ ok: true; limits: WarehouseLimits } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Supabase не настроен" };
  const merged = mergeLimits(limits);
  const { error } = await db.from("access_limits").upsert(
    { organization_id: organizationId, limits: merged, updated_by: actorEmail, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, limits: merged };
}
