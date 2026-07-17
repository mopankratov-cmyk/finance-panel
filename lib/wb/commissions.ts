// Фактические ставки WB по каждому nm_id — из детального финотчёта (reportDetailByPeriod).
// Комиссия: commission_percent (взвеш. по выручке). Эквайринг: acquiring_fee / выручка.
// extraPct: ВСЕ прочие удержания МП (логистика+хранение+штрафы+приёмка+прочие, КРОМЕ рекламы —
// она вычитается отдельно как ad_spent) / выручка — для «маржи после всех расходов МП».
// overheadPct: удержания без nm_id (account-level) → плоская надбавка ко всем SKU.
// Отчёт может занимать десятки мегабайт. Держим только компактный in-memory итог,
// но никогда не кладём сырой ответ в Next Data Cache: на больших кабинетах попытка
// кэширования нескольких JSON подряд переполняет память Vercel.

import { cabinetProductScope, getActiveWbCabinets, getWbCabinet, resolveWbToken } from "./cabinetTokens";
import { allowsProduct, type WbProductScope } from "./productScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchWbReportPages } from "./reportPagination";

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;

interface ReportRow {
  rrd_id?: number;
  nm_id?: number;
  brand_name?: string;
  supplier_oper_name?: string;
  bonus_type_name?: string;
  commission_percent?: number;
  ppvz_sales_commission?: number;
  acquiring_fee?: number;
  retail_price_withdisc_rub?: number;
  retail_amount?: number;
  delivery_rub?: number;
  storage_fee?: number;
  penalty?: number;
  acceptance?: number;
  deduction?: number;
}

export interface NmRates { pct: number; acqPct: number; extraPct: number; rev: number }
export interface WbCommission {
  byNm: Map<number, NmRates>;
  avgPct: number;      // средневзвеш. комиссия — фолбэк
  avgAcqPct: number;   // средневзвеш. эквайринг — фолбэк
  avgExtraPct: number; // средневзвеш. прочие удержания МП — фолбэк
  overheadPct: number; // удержания без nm_id (account-level), плоско ко всем
}

export interface ResolvedWbRates {
  commissionPct: number;
  acquiringPct: number;
  extraPct: number;
  overheadPct: number;
  marketplacePct: number;
  factual: boolean;
  source: "nm" | "mixed" | "avg" | "missing";
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r1 = (n: number) => Math.round(n * 10) / 10;

const positiveRate = (value: number) => Number.isFinite(value) && value > 0;
const nonNegativeRate = (value: number) => Number.isFinite(value) && value >= 0;

export function emptyWbCommission(): WbCommission {
  return { byNm: new Map(), avgPct: 0, avgAcqPct: 0, avgExtraPct: 0, overheadPct: 0 };
}

export function resolveWbRatesForNm(comm: WbCommission, nm: number): ResolvedWbRates {
  const row = comm.byNm.get(nm);
  const rowHasFact = Boolean(row && Number.isFinite(row.rev) && row.rev > 0);
  const commissionFromNm = Boolean(rowHasFact && row && positiveRate(row.pct));
  const acquiringFromNm = Boolean(rowHasFact && row && positiveRate(row.acqPct));
  const extraFromNm = Boolean(rowHasFact && row && nonNegativeRate(row.extraPct));
  const commissionPct = commissionFromNm ? row!.pct : (positiveRate(comm.avgPct) ? comm.avgPct : 0);
  const acquiringPct = acquiringFromNm ? row!.acqPct : (positiveRate(comm.avgAcqPct) ? comm.avgAcqPct : 0);
  const extraPct = extraFromNm ? row!.extraPct : (nonNegativeRate(comm.avgExtraPct) ? comm.avgExtraPct : 0);
  const overheadPct = nonNegativeRate(comm.overheadPct) ? comm.overheadPct : 0;
  const factual = positiveRate(commissionPct) && positiveRate(acquiringPct);
  const nmParts = Number(commissionFromNm) + Number(acquiringFromNm) + Number(extraFromNm);

  return {
    commissionPct,
    acquiringPct,
    extraPct,
    overheadPct,
    marketplacePct: commissionPct + extraPct + overheadPct,
    factual,
    source: !factual ? "missing" : nmParts === 3 ? "nm" : nmParts > 0 ? "mixed" : "avg",
  };
}

const _memo = new Map<string, { ts: number; val: WbCommission }>();
const MEMO_TTL = 6 * 3600 * 1000;

// opts.token — токен конкретного кабинета (per-cabinet факт-комиссия); opts.cacheKey — id кабинета.
export async function getWbCommission(days = 30, opts?: { token?: string; cacheKey?: string; scope?: WbProductScope; throwOnError?: boolean }): Promise<WbCommission> {
  const token = opts?.token || WB_STATS_TOKEN;
  const scope = opts?.scope ?? { brandFilters: [], allowedNmIds: null };
  const key = `${opts?.cacheKey || "env"}|${days}|${scope.allowedNmIds?.join(",") ?? "all"}`;
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.ts < MEMO_TTL) return hit.val;
  const empty = emptyWbCommission();
  if (!token) return empty;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let rows: ReportRow[];
  try {
    rows = (await fetchWbReportPages<ReportRow>({
      token,
      dateFrom: from,
      dateTo: to,
      cacheKey: opts?.cacheKey || "env",
    })).rows;
  } catch (error) {
    if (opts?.throwOnError) throw error;
    return empty;
  }
  if (!Array.isArray(rows)) return empty;

  // На nm: Σ(commission% × rev), Σ acquiring, Σ extra (прочие удержания МП), Σ rev. Без nm → overhead.
  const acc = new Map<number, { wpct: number; acq: number; extra: number; rev: number }>();
  let totW = 0, totAcq = 0, totRev = 0, totExtra = 0, noNmExtra = 0;
  for (const r of rows) {
    if (!allowsProduct(scope, r.nm_id, r.brand_name)) continue;
    const op = r.supplier_oper_name ?? "";
    const nm = Number(r.nm_id ?? 0);
    const isSale = !op || op === "Продажа";
    const rev = num(r.retail_price_withdisc_rub) || num(r.retail_amount);
    // прочие расходы МП в этой строке (КРОМЕ рекламы — она отдельно как ad_spent)
    let ded = num(r.deduction);
    const bt = (r.bonus_type_name ?? "").toLowerCase();
    if (bt.includes("продвижени") || bt.includes("реклам")) ded = 0;
    const extraRow = Math.abs(num(r.delivery_rub)) + Math.abs(num(r.storage_fee)) + Math.abs(num(r.penalty)) + Math.abs(num(r.acceptance)) + Math.max(0, ded);

    if (nm) {
      const e = acc.get(nm) ?? { wpct: 0, acq: 0, extra: 0, rev: 0 };
      if (isSale && rev > 0) {
        let pct = Math.abs(num(r.commission_percent));
        if (pct <= 0) pct = (Math.abs(num(r.ppvz_sales_commission)) / rev) * 100;
        const acq = Math.abs(num(r.acquiring_fee));
        e.wpct += pct * rev; e.acq += acq; e.rev += rev;
        totW += pct * rev; totAcq += acq; totRev += rev;
      }
      e.extra += extraRow;
      acc.set(nm, e);
      totExtra += extraRow;
    } else {
      noNmExtra += extraRow;
    }
  }

  const byNm = new Map<number, NmRates>();
  for (const [nm, e] of acc) byNm.set(nm, {
    pct: e.rev > 0 ? r1(e.wpct / e.rev) : 0,
    acqPct: e.rev > 0 ? r1((e.acq / e.rev) * 100) : 0,
    extraPct: e.rev > 0 ? r1((e.extra / e.rev) * 100) : 0,
    rev: e.rev,
  });
  const avgPct = totRev > 0 ? r1(totW / totRev) : 0;
  const avgAcqPct = totRev > 0 ? r1((totAcq / totRev) * 100) : 0;
  const avgExtraPct = totRev > 0 ? r1((totExtra / totRev) * 100) : 0;
  const overheadPct = totRev > 0 ? r1((noNmExtra / totRev) * 100) : 0;
  const val: WbCommission = { byNm, avgPct, avgAcqPct, avgExtraPct, overheadPct };
  if (byNm.size > 0) _memo.set(key, { ts: Date.now(), val });
  return val;
}

// Факт-ставки по nm со ВСЕХ активных кабинетов — читает кэш-таблицу (см. миграцию
// wb_nm_commissions, наполняется app/api/sync/commissions раз в сутки). Кэш пуст
// (первый запуск/синк ещё не прошёл) → фолбэк на live-запрос ко всем кабинетам, как раньше.
export async function getWbCommissionMerged(days = 30): Promise<WbCommission> {
  const cached = await getWbCommissionFromCache();
  if (cached) return cached;
  return getWbCommissionMergedLive(days);
}

// Один источник выбора ставок для экранов с глобальным переключателем кабинета.
// Конкретный кабинет не должен случайно получать среднюю комиссию другого юрлица.
export async function getWbCommissionForCabinet(
  cabinetId: string | null,
  days = 30,
  options: { allowLiveFallback?: boolean } = {},
): Promise<WbCommission> {
  const allowLiveFallback = options.allowLiveFallback ?? true;
  if (!cabinetId) {
    const cached = await getWbCommissionFromCache();
    if (cached) return cached;
    return allowLiveFallback ? getWbCommissionMergedLive(days) : emptyWbCommission();
  }
  const cached = await getWbCommissionFromCache(cabinetId);
  if (cached) return cached;
  if (!allowLiveFallback) return emptyWbCommission();
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return getWbCommissionMerged(days);
  return getWbCommission(days, {
    token: resolveWbToken(cabinet, "statistics"),
    cacheKey: cabinet.id,
    scope: cabinetProductScope(cabinet),
  });
}

async function getWbCommissionFromCache(cabinetId: string | null = null): Promise<WbCommission | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  let nmQuery = db.from("wb_nm_commissions").select("cabinet_id, nm_id, pct, acq_pct, extra_pct, rev");
  let overheadQuery = db.from("wb_cabinet_commission_overhead").select("cabinet_id, overhead_pct, rev");
  if (cabinetId) {
    nmQuery = nmQuery.eq("cabinet_id", cabinetId);
    overheadQuery = overheadQuery.eq("cabinet_id", cabinetId);
  }
  const [nmRes, ohRes] = await Promise.all([
    nmQuery,
    overheadQuery,
  ]);
  const nmRows = nmRes.data ?? [];
  if (!nmRows.length) return null; // кэш ещё не наполнен синком

  // один nm в нескольких кабинетах — берём строку с большей выручкой (как в live-мердже)
  const byNm = new Map<number, NmRates>();
  for (const r of nmRows as { nm_id: number; pct: number; acq_pct: number; extra_pct: number; rev: number }[]) {
    const nm = Number(r.nm_id);
    const rev = Number(r.rev ?? 0);
    const ex = byNm.get(nm);
    if (!ex || rev > ex.rev) byNm.set(nm, { pct: Number(r.pct ?? 0), acqPct: Number(r.acq_pct ?? 0), extraPct: Number(r.extra_pct ?? 0), rev });
  }
  let totW = 0, totAcq = 0, totExtra = 0, totRev = 0;
  for (const e of byNm.values()) { totW += e.pct * e.rev; totAcq += e.acqPct * e.rev; totExtra += e.extraPct * e.rev; totRev += e.rev; }

  const ohRows = (ohRes.data ?? []) as { overhead_pct: number; rev: number }[];
  let totOverheadW = 0, totOverheadRev = 0;
  for (const o of ohRows) { const rev = Number(o.rev ?? 0); totOverheadW += Number(o.overhead_pct ?? 0) * rev; totOverheadRev += rev; }

  return {
    byNm,
    avgPct: totRev > 0 ? r1(totW / totRev) : 0,
    avgAcqPct: totRev > 0 ? r1(totAcq / totRev) : 0,
    avgExtraPct: totRev > 0 ? r1(totExtra / totRev) : 0,
    overheadPct: totOverheadRev > 0 ? r1(totOverheadW / totOverheadRev) : 0,
  };
}

async function getWbCommissionMergedLive(days: number): Promise<WbCommission> {
  const cabs = await getActiveWbCabinets();
  if (!cabs.length) return getWbCommission(days); // фолбэк на ENV
  const parts = await Promise.all(cabs.map((c) => getWbCommission(days, {
    token: c.token,
    cacheKey: c.id,
    scope: cabinetProductScope(c),
  })));
  const byNm = new Map<number, NmRates>();
  for (const p of parts) {
    for (const [nm, e] of p.byNm) {
      const ex = byNm.get(nm);
      if (!ex || e.rev > ex.rev) byNm.set(nm, e); // один nm в двух кабинетах — берём с большей выручкой
    }
  }
  let totW = 0, totAcq = 0, totExtra = 0, totRev = 0, totOverheadW = 0;
  for (const e of byNm.values()) { totW += e.pct * e.rev; totAcq += e.acqPct * e.rev; totExtra += e.extraPct * e.rev; totRev += e.rev; }
  // overhead взвешиваем по выручке кабинета
  for (const p of parts) { const rev = [...p.byNm.values()].reduce((s, e) => s + e.rev, 0); totOverheadW += p.overheadPct * rev; }
  return {
    byNm,
    avgPct: totRev > 0 ? r1(totW / totRev) : 0,
    avgAcqPct: totRev > 0 ? r1(totAcq / totRev) : 0,
    avgExtraPct: totRev > 0 ? r1(totExtra / totRev) : 0,
    overheadPct: totRev > 0 ? r1(totOverheadW / totRev) : 0,
  };
}
