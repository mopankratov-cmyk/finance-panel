// Ozon Performance API (реклама). OAuth2 client_credentials → Bearer.
const BASE = "https://api-performance.ozon.ru";

export interface PerfCreds { clientId: string; secret: string }

const numRu = (v: unknown) => Number(String(v ?? "0").replace(/\s/g, "").replace(",", ".")) || 0;

export async function getPerfToken(c: PerfCreds): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/client/token`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: c.clientId, client_secret: c.secret, grant_type: "client_credentials" }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string };
    return j.access_token ?? null;
  } catch {
    return null;
  }
}

export async function validatePerf(c: PerfCreds): Promise<boolean> {
  return (await getPerfToken(c)) != null;
}

// Посуточный расход на рекламу (сумма по всем кампаниям) + заказы с рекламы.
export async function perfDailySpend(
  c: PerfCreds, dateFrom: string, dateTo: string,
): Promise<{ byDate: Record<string, { spent: number; ordersMoney: number; orders: number }> } | null> {
  const token = await getPerfToken(c);
  if (!token) return null;
  try {
    const res = await fetch(`${BASE}/api/client/statistics/daily/json?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
      headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rows?: { date: string; moneySpent: string; orders: string; ordersMoney: string }[] };
    const byDate: Record<string, { spent: number; ordersMoney: number; orders: number }> = {};
    for (const r of j.rows ?? []) {
      const d = String(r.date).slice(0, 10);
      const e = byDate[d] ?? { spent: 0, ordersMoney: 0, orders: 0 };
      e.spent += numRu(r.moneySpent);
      e.ordersMoney += numRu(r.ordersMoney);
      e.orders += numRu(r.orders);
      byDate[d] = e;
    }
    return { byDate };
  } catch {
    return null;
  }
}
