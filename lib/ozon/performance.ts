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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-SKU расход на рекламу за период (async-отчёт Performance по SKU-кампаниям).
// {bySku:{sku:{spent,ordersMoney}}} — расход и продажи с рекламы по каждому товару.
export async function perfProductReport(
  c: PerfCreds, fromIso: string, toIso: string, maxCampaigns = 40,
): Promise<{ bySku: Record<string, { spent: number; ordersMoney: number }>; partial: boolean } | null> {
  const token = await getPerfToken(c);
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };
  try {
    // 1) SKU-кампании
    const cr = await fetch(`${BASE}/api/client/campaign`, { headers: auth, cache: "no-store" });
    if (!cr.ok) return null;
    const cj = (await cr.json()) as { list?: { id: string | number; advObjectType?: string; state?: string }[] };
    const allIds = (cj.list ?? []).filter((c) => c.advObjectType === "SKU").map((c) => String(c.id));
    const ids = allIds.slice(0, maxCampaigns);
    const partial = allIds.length > ids.length;
    if (!ids.length) return { bySku: {}, partial: false };

    const bySku: Record<string, { spent: number; ordersMoney: number }> = {};
    // 2) отчёт батчами по 10 кампаний (лимит API)
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const gen = await fetch(`${BASE}/api/client/statistics/json`, {
        method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ campaigns: batch, from: fromIso, to: toIso, groupBy: "NO_GROUP_BY" }),
        cache: "no-store",
      });
      if (!gen.ok) continue;
      const uuid = ((await gen.json()) as { UUID?: string }).UUID;
      if (!uuid) continue;
      // 3) поллинг (бюджет ~12с на батч)
      let ready = false;
      for (let t = 0; t < 8; t++) {
        await sleep(1500);
        const st = await fetch(`${BASE}/api/client/statistics/${uuid}`, { headers: auth, cache: "no-store" });
        if (st.ok && ((await st.json()) as { state?: string }).state === "OK") { ready = true; break; }
      }
      if (!ready) continue;
      // 4) скачать
      const rep = await fetch(`${BASE}/api/client/statistics/report?UUID=${uuid}`, { headers: auth, cache: "no-store" });
      if (!rep.ok) continue;
      const data = (await rep.json()) as Record<string, { report?: { rows?: { sku?: string; moneySpent?: string; ordersMoney?: string }[] } }>;
      for (const camp of Object.values(data)) {
        for (const row of camp.report?.rows ?? []) {
          const sku = String(row.sku ?? "");
          if (!sku) continue;
          const e = bySku[sku] ?? { spent: 0, ordersMoney: 0 };
          e.spent += numRu(row.moneySpent);
          e.ordersMoney += numRu(row.ordersMoney);
          bySku[sku] = e;
        }
      }
    }
    return { bySku, partial };
  } catch {
    return null;
  }
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
