// Фактические ставки WB по каждому nm_id — из детального финотчёта (reportDetailByPeriod).
// Комиссия: commission_percent (взвеш. по выручке). Эквайринг: acquiring_fee / выручка.
// Кэш через Next fetch revalidate (отчёт тяжёлый ~12с) — тянется раз в 6ч на весь сервер.

import { getActiveWbCabinets } from "./cabinetTokens";

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

// In-process memo (отчёт тяжёлый ~12с). TTL 6ч. Ключ — кабинет+период (иначе кабинеты травят кэш друг друга).
const _memo = new Map<string, { ts: number; val: WbCommission }>();
const MEMO_TTL = 6 * 3600 * 1000;

// opts.token — токен конкретного кабинета (per-cabinet факт-комиссия); opts.cacheKey — id кабинета.
export async function getWbCommission(days = 30, opts?: { token?: string; cacheKey?: string }): Promise<WbCommission> {
  const token = opts?.token || WB_STATS_TOKEN;
  const key = `${opts?.cacheKey || "env"}|${days}`;
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.ts < MEMO_TTL) return hit.val;
  const empty: WbCommission = { byNm: new Map(), avgPct: 0, avgAcqPct: 0 };
  if (!token) return empty;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${from}&dateTo=${to}&limit=100000&rrdid=0&_c=${encodeURIComponent(opts?.cacheKey || "env")}`;

  let rows: ReportRow[];
  try {
    const res = await fetch(url, { headers: { Authorization: token }, next: { revalidate: 21600 } });
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
  if (byNm.size > 0) _memo.set(key, { ts: Date.now(), val }); // кэшируем только удачный результат
  return val;
}

// Факт-комиссия по nm со ВСЕХ активных кабинетов (каждый nm — из финотчёта своего кабинета).
// Для кросс-кабинетных таблиц (юнит): ENV-токен пуст/неактуален → берём токены кабинетов из БД.
export async function getWbCommissionMerged(days = 30): Promise<WbCommission> {
  const cabs = await getActiveWbCabinets();
  if (!cabs.length) return getWbCommission(days); // фолбэк на ENV
  const parts = await Promise.all(cabs.map((c) => getWbCommission(days, { token: c.token, cacheKey: c.id })));
  const byNm = new Map<number, { pct: number; acqPct: number; rev: number }>();
  for (const p of parts) {
    for (const [nm, e] of p.byNm) {
      const ex = byNm.get(nm);
      if (!ex || e.rev > ex.rev) byNm.set(nm, e); // один nm в двух кабинетах — берём с большей выручкой
    }
  }
  let totW = 0, totAcq = 0, totRev = 0;
  for (const e of byNm.values()) { totW += e.pct * e.rev; totAcq += e.acqPct * e.rev; totRev += e.rev; }
  return {
    byNm,
    avgPct: totRev > 0 ? Math.round((totW / totRev) * 10) / 10 : 0,
    avgAcqPct: totRev > 0 ? Math.round((totAcq / totRev) * 10) / 10 : 0,
  };
}
