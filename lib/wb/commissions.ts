// Фактические ставки WB по каждому nm_id — из детального финотчёта (reportDetailByPeriod).
// Комиссия: commission_percent (взвеш. по выручке). Эквайринг: acquiring_fee / выручка.
// Кэш через Next fetch revalidate (отчёт тяжёлый ~12с) — тянется раз в 6ч на весь сервер.

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;

interface ReportRow {
  nm_id?: number;
  supplier_oper_name?: string;
  commission_percent?: number;
  ppvz_sales_commission?: number;
  acquiring_fee?: number;
  retail_price_withdisc_rub?: number;
  retail_amount?: number;
}

export interface WbCommission {
  byNm: Map<number, { pct: number; acqPct: number; rev: number }>;
  avgPct: number;    // средневзвешенная комиссия по кабинету — фолбэк
  avgAcqPct: number; // средневзвешенный эквайринг по кабинету — фолбэк
}

const num = (v: unknown) => Number(v ?? 0) || 0;

// In-process memo (отчёт тяжёлый ~12с). TTL 6ч. Живёт в процессе сервера — не зависит от Next fetch-кэша.
let _memo: { ts: number; days: number; val: WbCommission } | null = null;
const MEMO_TTL = 6 * 3600 * 1000;

export async function getWbCommission(days = 30): Promise<WbCommission> {
  if (_memo && _memo.days === days && Date.now() - _memo.ts < MEMO_TTL) return _memo.val;
  const empty: WbCommission = { byNm: new Map(), avgPct: 0, avgAcqPct: 0 };
  if (!WB_STATS_TOKEN) return empty;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${from}&dateTo=${to}&limit=100000&rrdid=0`;

  let rows: ReportRow[];
  try {
    const res = await fetch(url, { headers: { Authorization: WB_STATS_TOKEN }, next: { revalidate: 21600 } });
    if (!res.ok) return empty;
    rows = (await res.json()) as ReportRow[];
  } catch {
    return empty;
  }
  if (!Array.isArray(rows)) return empty;

  // На nm копим Σ(commission_percent × rev), Σ acquiring_fee, Σrev
  const acc = new Map<number, { wpct: number; acq: number; rev: number }>();
  let totW = 0, totAcq = 0, totRev = 0;
  for (const r of rows) {
    if (r.supplier_oper_name && r.supplier_oper_name !== "Продажа") continue; // только продажи
    const nm = Number(r.nm_id ?? 0);
    if (!nm) continue;
    const rev = num(r.retail_price_withdisc_rub) || num(r.retail_amount);
    if (rev <= 0) continue;
    // headline-% комиссии; фолбэк — |ppvz_sales_commission|/rev
    let pct = Math.abs(num(r.commission_percent));
    if (pct <= 0) pct = (Math.abs(num(r.ppvz_sales_commission)) / rev) * 100;
    const acq = Math.abs(num(r.acquiring_fee));
    const e = acc.get(nm) ?? { wpct: 0, acq: 0, rev: 0 };
    e.wpct += pct * rev; e.acq += acq; e.rev += rev;
    acc.set(nm, e);
    totW += pct * rev; totAcq += acq; totRev += rev;
  }

  const byNm = new Map<number, { pct: number; acqPct: number; rev: number }>();
  for (const [nm, e] of acc) byNm.set(nm, {
    pct: Math.round((e.wpct / e.rev) * 10) / 10,
    acqPct: Math.round((e.acq / e.rev) * 1000) / 10,
    rev: e.rev,
  });
  const avgPct = totRev > 0 ? Math.round((totW / totRev) * 10) / 10 : 0;
  const avgAcqPct = totRev > 0 ? Math.round((totAcq / totRev) * 1000) / 10 : 0;
  const val: WbCommission = { byNm, avgPct, avgAcqPct };
  if (byNm.size > 0) _memo = { ts: Date.now(), days, val }; // кэшируем только удачный результат
  return val;
}
