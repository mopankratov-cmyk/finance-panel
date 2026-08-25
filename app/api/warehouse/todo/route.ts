import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveEntity } from "@/lib/warehouse/entityAccess";
import { plural } from "@/lib/warehouse/plural";

export const dynamic = "force-dynamic";

/** Дело, которое склад должен закрыть. Не отчёт, а короткая строка «сходи сюда». */
export interface WarehouseTodo {
  key: "kizOverdue" | "kizPending" | "receiptsHanging" | "negative" | "belowMin";
  tone: "danger" | "warn";
  count: number;
  label: string;
  tab: "kiz" | "receipts" | "balances" | "products";
}

const fail = (error: string, status: number) => NextResponse.json({ data: null, error }, { status });
const missing = (code?: string) => ["42P01", "42703", "PGRST204", "PGRST205"].includes(code ?? "");

/** Полоса дел. Каждое число здесь — то, что кто-то должен сделать руками;
 *  всё, что просто «есть на складе», живёт на вкладках и сюда не попадает.
 *
 *  Отдельный лёгкий роут, а не сумма вкладок: полоса грузится при каждом входе
 *  в модуль, и тянуть ради неё полные списки остатков и реестр кодов — дорого.
 *  Тут только счётчики. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const scope = await resolveEntity(new URL(request.url).searchParams.get("entity"));
  if (!scope.ok) return fail(scope.error, scope.status);

  const db = getSupabaseAdmin();
  if (!db) return fail("Supabase не настроен", 500);

  const entityId = scope.entity.id;
  const ownCabinets = scope.entity.cabinets.filter((link) => link.relation === "own").map((link) => link.cabinetId);
  // Три рабочих дня на вывод из оборота, считаем календарно с запасом — так же,
  // как их считает вкладка «Маркировка».
  const overdueBefore = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

  const [kizPending, kizOverdue, receipts, balances, products] = await Promise.all([
    db.from("kiz_withdrawals").select("code", { count: "exact", head: true }).eq("status", "sold"),
    db.from("kiz_withdrawals").select("code", { count: "exact", head: true }).eq("status", "sold").lt("sold_at", overdueBefore),
    ownCabinets.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from("purchase_receipts").select("batch_id").in("cabinet_id", ownCabinets).eq("status", "received").is("posted_at", null),
    loadAllSupabasePages<{ product_id: string; qty: number }>((from, to) =>
      db.from("stock_balances").select("product_id, qty").eq("legal_entity_id", entityId).range(from, to),
    ).catch(() => [] as { product_id: string; qty: number }[]),
    db.from("products").select("id, min_stock").eq("legal_entity_id", entityId).eq("is_active", true).not("min_stock", "is", null),
  ]);

  // Реестр кодов и справочник товаров могут быть не мигрированы — полоса дел не
  // повод ронять весь модуль, просто одним делом меньше.
  const pendingCount = kizPending.error ? 0 : (kizPending.count ?? 0);
  const overdueCount = kizOverdue.error ? 0 : (kizOverdue.count ?? 0);

  const hangingBatches = receipts.error
    ? 0
    : new Set(((receipts.data ?? []) as { batch_id: string }[]).map((row) => String(row.batch_id))).size;

  const stock = new Map<string, number>();
  for (const row of balances) {
    stock.set(String(row.product_id), (stock.get(String(row.product_id)) ?? 0) + Number(row.qty));
  }
  const negative = [...stock.values()].filter((qty) => qty < 0).length;

  const belowMin = missing(products.error?.code) || products.error
    ? 0
    : ((products.data ?? []) as { id: string; min_stock: number | null }[])
      .filter((row) => row.min_stock !== null && (stock.get(String(row.id)) ?? 0) < Number(row.min_stock)).length;

  const items: WarehouseTodo[] = [];
  if (overdueCount > 0) {
    items.push({
      key: "kizOverdue",
      tone: "danger",
      count: overdueCount,
      label: `${overdueCount} ${plural(overdueCount, "код просрочен", "кода просрочены", "кодов просрочены")}`,
      tab: "kiz",
    });
  } else if (pendingCount > 0) {
    // Пока просрочки нет, «ждут вывода» — обычная работа, а не тревога.
    items.push({
      key: "kizPending",
      tone: "warn",
      count: pendingCount,
      label: `${pendingCount} ${plural(pendingCount, "код ждёт", "кода ждут", "кодов ждут")} вывода из оборота`,
      tab: "kiz",
    });
  }
  if (negative > 0) {
    items.push({
      key: "negative",
      tone: "danger",
      count: negative,
      label: `${negative} ${plural(negative, "товар ушёл", "товара ушли", "товаров ушли")} в минус`,
      tab: "balances",
    });
  }
  if (hangingBatches > 0) {
    items.push({
      key: "receiptsHanging",
      tone: "warn",
      count: hangingBatches,
      label: `${hangingBatches} ${plural(hangingBatches, "партия принята", "партии приняты", "партий приняты")}, но не на остатке`,
      tab: "receipts",
    });
  }
  if (belowMin > 0) {
    items.push({
      key: "belowMin",
      tone: "warn",
      count: belowMin,
      label: `${belowMin} ${plural(belowMin, "товар ниже", "товара ниже", "товаров ниже")} минимума`,
      tab: "products",
    });
  }

  return NextResponse.json({ data: { items }, error: null });
}
