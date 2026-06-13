// Ozon Seller API. Авторизация — заголовки Client-Id + Api-Key. База api-seller.ozon.ru.
const BASE = "https://api-seller.ozon.ru";

export interface OzonCreds {
  clientId: string;
  apiKey: string;
}

function headers(c: OzonCreds): HeadersInit {
  return { "Client-Id": c.clientId.trim(), "Api-Key": c.apiKey.trim(), "Content-Type": "application/json" };
}

// Валидация ключа: лёгкий запрос финансовых итогов за 1 день. 200 → ключ рабочий.
export async function validateOzon(
  c: OzonCreds,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!c.clientId?.trim() || !c.apiKey?.trim()) return { ok: false, error: "Укажите Client-Id и Api-Key" };
  const to = new Date();
  const from = new Date(Date.now() - 86400000);
  try {
    const res = await fetch(`${BASE}/v3/finance/transaction/totals`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ date: { from: from.toISOString(), to: to.toISOString() }, posting_number: "", transaction_type: "all" }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Ключ невалиден (${res.status})`, status: res.status };
    if (!res.ok) return { ok: false, error: `Ozon ответил ${res.status}`, status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Сеть: ${String(e).slice(0, 80)}` };
  }
}

export interface OzonTotals {
  accruals_for_sale: number;
  sale_commission: number;
  processing_and_delivery: number;
  refunds_and_cancellations: number;
  services_amount: number;
  compensation_amount: number;
  money_transfer: number;
  others_amount: number;
}

// Итоги транзакций за период (аналог финотчёта WB): начислено/комиссия/логистика/услуги/возвраты.
export async function ozonTransactionTotals(
  c: OzonCreds, fromIso: string, toIso: string,
): Promise<{ ok: true; totals: OzonTotals } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}/v3/finance/transaction/totals`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ date: { from: fromIso, to: toIso }, posting_number: "", transaction_type: "all" }),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}` };
    const j = (await res.json()) as { result?: OzonTotals };
    if (!j.result) return { ok: false, error: "Ozon не вернул result" };
    return { ok: true, totals: j.result };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Детализация услуг (реклама/хранение/...) из transaction/list по operation_type.
export async function ozonServiceBreakdown(
  c: OzonCreds, fromIso: string, toIso: string,
): Promise<Record<string, number>> {
  const acc: Record<string, number> = {};
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(`${BASE}/v3/finance/transaction/list`, {
        method: "POST",
        headers: headers(c),
        body: JSON.stringify({ filter: { date: { from: fromIso, to: toIso }, transaction_type: "all" }, page, page_size: 1000 }),
        next: { revalidate: 3600 },
      });
      if (!res.ok) break;
      const j = (await res.json()) as { result?: { operations?: { services?: { name: string; price: number }[] }[]; page_count?: number } };
      const ops = j.result?.operations ?? [];
      for (const op of ops) for (const s of op.services ?? []) acc[s.name] = (acc[s.name] ?? 0) + Number(s.price ?? 0);
      if (!ops.length || page >= (j.result?.page_count ?? 1)) break;
    }
  } catch {
    /* ignore */
  }
  return acc;
}
