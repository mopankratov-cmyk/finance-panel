import type { SupabaseClient } from "@supabase/supabase-js";
import { buyerMayWriteOff, type ApprovalVerdict } from "@/lib/auth/approvals";
import { loadLimits } from "@/lib/auth/limitsStore";
import { rolesCan } from "@/lib/auth/permissions";

/**
 * Порог списания в точке списания.
 *
 * Владелец задал два предела: 10 000 ₽ по одному документу и 30 000 ₽
 * суммарно за календарный месяц, «по учётной себестоимости товара в рублях
 * на дату документа». Права мало: без этой проверки закупщик списывал бы
 * любую сумму, потому что право у него есть.
 *
 * СУММА ЗА МЕСЯЦ БЕРЁТСЯ ИЗ ЖУРНАЛА. Он неизменяем — ни удалить, ни
 * переписать записи нельзя даже панели, — поэтому накопленный итог нельзя
 * обнулить, списав что-нибудь и подчистив след. Отдельный счётчик был бы
 * вторым источником правды и разошёлся бы с историей на первом же сбое.
 *
 * НЕИЗВЕСТНАЯ СЕБЕСТОИМОСТЬ НЕ ПРОХОДИТ. Ноль вместо неизвестного здесь
 * означал бы «списание бесплатное», и любой товар без учётной цены стал бы
 * дырой в пороге. Такое списание уходит на подпись — у руководителя и
 * финдиректора порога нет вовсе.
 */

export interface WriteOffLine {
  variantId: string;
  qty: number;
}

export type WriteOffLimitVerdict =
  | { allowed: true; costRub: number }
  | { allowed: false; reason: string; costRub: number | null };

/** Стоимость списания по учётной себестоимости. `null` — цена не у всех позиций. */
export async function writeOffCost(
  db: SupabaseClient,
  lines: WriteOffLine[],
): Promise<{ ok: true; costRub: number } | { ok: false; missing: string[] }> {
  const ids = [...new Set(lines.map((line) => line.variantId))];
  if (!ids.length) return { ok: true, costRub: 0 };

  const { data: variants } = await db
    .from("product_variants")
    .select("id, product_id, products(article)")
    .in("id", ids);

  const articleByVariant = new Map<string, string>();
  for (const row of variants ?? []) {
    const product = (row as { products?: { article?: string } | { article?: string }[] }).products;
    const article = Array.isArray(product) ? product[0]?.article : product?.article;
    if (article) articleByVariant.set(String((row as { id: string }).id), String(article));
  }

  const articles = [...new Set([...articleByVariant.values()])];
  const { data: costs } = articles.length
    ? await db.from("product_costs").select("article, cost_rub").in("article", articles)
    : { data: [] as { article: string; cost_rub: number }[] };
  const costByArticle = new Map((costs ?? []).map((row) => [String(row.article), Number(row.cost_rub) || 0]));

  const missing: string[] = [];
  let total = 0;
  for (const line of lines) {
    const article = articleByVariant.get(line.variantId);
    const cost = article ? costByArticle.get(article) : undefined;
    if (article == null || cost == null) {
      missing.push(article ?? line.variantId);
      continue;
    }
    total += cost * Number(line.qty || 0);
  }
  if (missing.length) return { ok: false, missing: [...new Set(missing)] };
  return { ok: true, costRub: Math.round(total * 100) / 100 };
}

/** Сколько этот человек уже списал в текущем календарном месяце. */
export async function writeOffMonthToDate(db: SupabaseClient, actorId: string | null): Promise<number> {
  if (!actorId) return 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db
    .from("access_audit_log")
    .select("after_data")
    .eq("actor_id", actorId)
    .eq("action", "warehouse.writeoff")
    .gte("created_at", monthStart);
  // Журнала ещё нет — считать нечего. Это не «ноль списаний», но и запретить
  // работу из-за неприменённой миграции нельзя: месячный порог включится
  // вместе с журналом.
  if (error) return 0;
  return (data ?? []).reduce((sum, row) => {
    const cost = Number((row.after_data as { costRub?: unknown } | null)?.costRub ?? 0);
    return sum + (Number.isFinite(cost) ? cost : 0);
  }, 0);
}

/**
 * Можно ли списать без чужой подписи.
 *
 * У руководителя и финансового директора порога нет: право
 * warehouse.stock.adjust у них не ограничено суммой, и это решение владельца,
 * а не упущение.
 */
export async function checkWriteOffLimit(
  db: SupabaseClient,
  session: { uid: string; organization_id: string | null; role: string; roles?: string[] } | null,
  roles: string[],
  lines: WriteOffLine[],
): Promise<WriteOffLimitVerdict> {
  if (rolesCan(roles, "finance.approve")) {
    // Тот, кто подписывает чужие списания, не спрашивает разрешения на своё.
    const cost = await writeOffCost(db, lines);
    return { allowed: true, costRub: cost.ok ? cost.costRub : 0 };
  }
  const cost = await writeOffCost(db, lines);
  if (!cost.ok) {
    return {
      allowed: false,
      costRub: null,
      reason: `нет учётной себестоимости: ${cost.missing.slice(0, 3).join(", ")}${cost.missing.length > 3 ? "…" : ""}. Такое списание подтверждает финансовый директор или руководитель`,
    };
  }
  const limits = await loadLimits(session?.organization_id ?? null);
  const monthToDate = await writeOffMonthToDate(db, session?.uid ?? null);
  const verdict: ApprovalVerdict = buyerMayWriteOff({ docRub: cost.costRub, monthToDateRub: monthToDate }, limits);
  if (!verdict.allowed) return { allowed: false, costRub: cost.costRub, reason: verdict.reason };
  return { allowed: true, costRub: cost.costRub };
}
