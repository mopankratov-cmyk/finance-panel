import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { consumedFactIds } from "./factLinks";

type PaymentFactLinkRow = { id: string; comment: string | null; settled_by_payment_id?: string | null };

async function loadPaymentFactLinks(db: SupabaseClient): Promise<PaymentFactLinkRow[]> {
  try {
    return await loadAllSupabasePages<PaymentFactLinkRow>(
      (from, to) => db.from("payments")
        .select("id,comment,settled_by_payment_id")
        .or("settled_by_payment_id.not.is.null,comment.like.%[%")
        .order("id", { ascending: true })
        .range(from, to),
      { label: "Связи планов с фактами ДДС", maxPages: 60 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/settled_by_payment_id.*(?:does not exist|schema cache)|could not find.*settled_by_payment_id/i.test(message)) throw error;
    return loadAllSupabasePages<PaymentFactLinkRow>(
      (from, to) => db.from("payments")
        .select("id,comment")
        .not("comment", "is", null)
        .like("comment", "%[%")
        .order("id", { ascending: true })
        .range(from, to),
      { label: "Старые связи планов с фактами ДДС", maxPages: 60 },
    );
  }
}

/**
 * Серверный источник занятых фактов ДДС. Текстовые метки сохраняют
 * совместимость со старыми строками и зарплатой, а отдельные колонки защищают
 * календарь и график кредита даже после потери метки в comment.
 */
export async function loadConsumedFactIds(
  db: SupabaseClient,
  exceptPlanId?: string,
): Promise<Set<string>> {
  const [payments, scheduleRows] = await Promise.all([
    loadPaymentFactLinks(db),
    loadAllSupabasePages<{ paid_by_payment_id: string | null }>(
      (from, to) => db.from("loan_schedule_rows")
        .select("paid_by_payment_id")
        .not("paid_by_payment_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
      { label: "Связи графика кредита с фактами", maxPages: 60 },
    ),
  ]);

  return consumedFactIds(
    payments.map((row) => ({
      id: row.id,
      comment: row.comment,
      settledByPaymentId: row.settled_by_payment_id,
    })),
    exceptPlanId,
    scheduleRows.map((row) => ({ paidByPaymentId: row.paid_by_payment_id })),
  );
}
