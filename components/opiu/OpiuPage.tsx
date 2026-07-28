"use client";

import { formatPct, formatRub, formatTime } from "@/lib/analytics/format";
import { currentMonthParam, weeksInMonth, parseMonthParam } from "@/lib/opiu/weeks";
import type { OpiuReport, OpiuTableRow } from "@/lib/opiu/buildReport";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface OpiuResponse {
  month: string;
  report: OpiuReport;
  timestamp: string;
  meta?: { salesRows: number; ordersCount: number; costsCount: number; adCampaigns: number };
  error?: string;
}

type Tab = "summary" | "detail" | "forecast" | "calendar" | "risks";

/* ── Mock SKU data для Карты рисков ── */
interface SkuRisk {
  nm: number;
  name: string;
  abc: "A" | "B" | "C" | "D";
  revenue: number;
  profit: number;
  margin: number | null;
  adSpend: number;
  drr: number | null;        // реклама / выручка %
  stock: number;             // шт
  turnoverDays: number | null;
  ordersPlan: number;        // плановые заказы за месяц, руб
  ordersActual: number;      // фактические заказы за месяц, руб
  planPct: number | null;    // факт / план %
}

const MOCK_SKUS: SkuRisk[] = [
  { nm:1001, name:"Термокружка 450 мл",          abc:"A", revenue:1_456_240, profit:312_000, margin:21.4, adSpend:55_520,  drr:3.8,  stock:120, turnoverDays:34,  ordersPlan:1_400_000, ordersActual:1_456_240, planPct:104 },
  { nm:1002, name:"Фильтры для кофе 100 шт",     abc:"A", revenue:1_382_590, profit:287_000, margin:20.8, adSpend:53_120,  drr:3.8,  stock:95,  turnoverDays:40,  ordersPlan:1_200_000, ordersActual:1_382_590, planPct:115 },
  { nm:1003, name:"Робот-пылесос CleanWow",       abc:"A", revenue:834_911,  profit:198_000, margin:23.7, adSpend:34_110,  drr:4.1,  stock:18,  turnoverDays:30,  ordersPlan:900_000,   ordersActual:834_911,  planPct:93  },
  { nm:1004, name:"Krups Roma White EA810570",    abc:"A", revenue:756_281,  profit:142_000, margin:18.8, adSpend:29_660,  drr:3.9,  stock:22,  turnoverDays:44,  ordersPlan:700_000,   ordersActual:756_281,  planPct:108 },
  { nm:1005, name:"Must Puro Arabica 1000 г",     abc:"B", revenue:740_128,  profit:98_000,  margin:13.2, adSpend:27_720,  drr:3.7,  stock:65,  turnoverDays:59,  ordersPlan:800_000,   ordersActual:740_128,  planPct:93  },
  { nm:1006, name:"Ahmad Tea Ceylon 100 пак.",    abc:"B", revenue:673_074,  profit:87_000,  margin:12.9, adSpend:25_360,  drr:3.8,  stock:80,  turnoverDays:67,  ordersPlan:700_000,   ordersActual:673_074,  planPct:96  },
  { nm:1007, name:"Подарочная упаковка",          abc:"B", revenue:520_350,  profit:71_000,  margin:13.6, adSpend:20_320,  drr:3.9,  stock:200, turnoverDays:118, ordersPlan:600_000,   ordersActual:520_350,  planPct:87  },
  { nm:1008, name:"Мойщик посуды mini",           abc:"C", revenue:312_000,  profit:22_000,  margin:7.1,  adSpend:37_440,  drr:12.0, stock:45,  turnoverDays:84,  ordersPlan:500_000,   ordersActual:312_000,  planPct:62  },
  { nm:1009, name:"Greenfield Golden Ceylon",     abc:"C", revenue:268_000,  profit:14_000,  margin:5.2,  adSpend:32_160,  drr:12.0, stock:38,  turnoverDays:71,  ordersPlan:400_000,   ordersActual:268_000,  planPct:67  },
  { nm:1010, name:"Пароочиститель Bort",          abc:"C", revenue:198_000,  profit:-8_500,  margin:-4.3, adSpend:31_680,  drr:16.0, stock:28,  turnoverDays:97,  ordersPlan:350_000,   ordersActual:198_000,  planPct:57  },
  { nm:1011, name:"DeLonghi ECAM21.117.SB",       abc:"D", revenue:118_483,  profit:-42_000, margin:-35.4,adSpend:49_850,  drr:42.1, stock:12,  turnoverDays:null,ordersPlan:300_000,   ordersActual:118_483,  planPct:39  },
  { nm:1012, name:"Nescafé Dolce Gusto 8 порций", abc:"D", revenue:89_000,   profit:-18_000, margin:-20.2,adSpend:29_150,  drr:32.8, stock:9,   turnoverDays:null,ordersPlan:200_000,   ordersActual:89_000,   planPct:45  },
  { nm:1013, name:"Усилитель Wi-Fi сигнала",      abc:"D", revenue:0,        profit:-3_200,  margin:null, adSpend:3_200,   drr:null, stock:34,  turnoverDays:null,ordersPlan:150_000,   ordersActual:0,        planPct:0   },
  { nm:1014, name:"Капельница для полива",        abc:"D", revenue:0,        profit:-1_800,  margin:null, adSpend:1_800,   drr:null, stock:18,  turnoverDays:null,ordersPlan:120_000,   ordersActual:0,        planPct:0   },
  { nm:1015, name:"Аэрогриль Redmond AF-777",     abc:"C", revenue:156_000,  profit:-5_600,  margin:-3.6, adSpend:28_080,  drr:18.0, stock:260, turnoverDays:231, ordersPlan:280_000,   ordersActual:156_000,  planPct:56  },
  { nm:1016, name:"Су-вид Kitfort KT-2021",       abc:"C", revenue:134_000,  profit:-3_100,  margin:-2.3, adSpend:20_100,  drr:15.0, stock:180, turnoverDays:209, ordersPlan:250_000,   ordersActual:134_000,  planPct:54  },
];

function deriveRisks(skus: SkuRisk[]) {
  return {
    losers:   skus.filter(s => s.profit < 0),
    redZone:  skus.filter(s => (s.planPct ?? 100) < 50 && s.ordersPlan >= 150_000 && s.revenue > 0),
    frozen:   skus.filter(s => (s.turnoverDays ?? 0) > 150 && s.stock > 0),
    highDrr:  skus.filter(s => (s.drr ?? 0) > 12 && s.revenue > 0),
    noTraffic:skus.filter(s => s.revenue === 0 && s.ordersPlan > 0),
    aItems:   skus.filter(s => s.abc === "A"),
  };
}


/* ── Mock report (используется когда API недоступен) ── */
function buildMockReport(month: string): OpiuReport {
  const { year, monthIndex } = parseMonthParam(month);
  const weeks = weeksInMonth(year, monthIndex);
  const n = weeks.length;

  const revNoSpp =   [1_420_000, 1_756_000, 1_684_000, 1_540_000, 890_000].slice(0, n);
  const revenue =    [  891_000, 1_108_000, 1_056_000,   970_000, 540_000].slice(0, n);
  const orders =     [1_540_000, 1_820_000, 1_980_000, 2_140_000, 1_160_000].slice(0, n);
  const forPay =     [  924_000, 1_181_000, 1_128_000, 1_030_000, 580_000].slice(0, n);
  const commission = revNoSpp.map((r, i) => r - forPay[i]!);
  const logistics =  [  161_000,   181_000,   168_000,   153_000, 80_000].slice(0, n);
  const cogs =       [  316_000,   368_000,   338_000,   308_000, 170_000].slice(0, n);
  const packaging =  [   45_000,    49_000,    44_000,    40_000, 22_000].slice(0, n);
  const penalties =  [      180,       120,       120,       100,     60].slice(0, n);
  const storage =    [    6_800,     9_600,    11_900,    10_000,  5_000].slice(0, n);
  const other =      [      114,         0,    -5_636,       200,    100].slice(0, n);
  const ads =        [  174_000,   343_000,   378_000,   345_000, 190_000].slice(0, n);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const tot = <T,>(arr: T[], total: T): T[] => [...arr, total];
  const pct = (a: number, b: number) => b ? (a / b) * 100 : null;

  const marginal = revNoSpp.map((r, i) =>
    r - commission[i]! - logistics[i]! - cogs[i]! - packaging[i]! - penalties[i]! - storage[i]! - other[i]!
    // loyalty_comp и pvz_comp в mock = 0, формула совпадает с buildReport.ts
  );
  const gross = marginal.map((m, i) => m - ads[i]!);

  const tRevNoSpp = sum(revNoSpp), tRev = sum(revenue), tOrd = sum(orders);
  const tForPay = sum(forPay), tComm = sum(commission), tLog = sum(logistics);
  const tCogs = sum(cogs), tPkg = sum(packaging), tPen = sum(penalties);
  const tStr = sum(storage), tOth = sum(other), tAds = sum(ads);
  const tMarg = sum(marginal), tGross = sum(gross);

  const zeroArr = Array(n + 1).fill(null);
  const sep = (id: string): OpiuTableRow => ({ id, label: "", kind: "separator", values: zeroArr });

  const rows: OpiuTableRow[] = [
    { id: "orders",        label: "Заказы, руб",                                  kind: "metric",  values: tot(orders,     tOrd) },
    { id: "rev_no_spp",    label: "Выручка без СПП, руб",                         kind: "metric",  values: tot(revNoSpp,   tRevNoSpp) },
    { id: "loyalty_comp", label: "Компенсация скидки по программе лояльности, руб", kind: "metric", expense: false, values: zeroArr },
    { id: "revenue",       label: "Выручка с учётом СПП, руб",                    kind: "metric",  values: tot(revenue,    tRev) },
    { id: "buyout",        label: "% выкупа",                                     kind: "percent", values: tot(revNoSpp.map((r, i) => pct(r, orders[i]!)), pct(tRevNoSpp, tOrd)) },
    { id: "for_pay",       label: "К перечислению продавцу, руб",                 kind: "metric",  values: tot(forPay,     tForPay) },
    sep("sep1"),
    { id: "commission",    label: "Комиссия ВБ, руб",                             kind: "metric",  expense: true, values: tot(commission, tComm) },
    { id: "commission_pct",label: "% комиссии",                                   kind: "percent", values: tot(commission.map((c, i) => pct(c, revNoSpp[i]!)), pct(tComm, tRevNoSpp)) },
    { id: "logistics",     label: "Логистика, руб",                               kind: "metric",  expense: true, values: tot(logistics,  tLog) },
    { id: "logistics_pct", label: "% логистики",                                  kind: "percent", values: tot(logistics.map((l, i) => pct(l, revNoSpp[i]!)), pct(tLog, tRevNoSpp)) },
    { id: "cogs",          label: "Себестоимость, руб",                           kind: "metric",  expense: true, values: tot(cogs,       tCogs) },
    { id: "cogs_pct",      label: "% себестоимости",                              kind: "percent", values: tot(cogs.map((c, i) => pct(c, revNoSpp[i]!)), pct(tCogs, tRevNoSpp)) },
    { id: "packaging",     label: "Подготовка (упаковка, маркировка, отгрузка)",  kind: "metric",  expense: true, values: tot(packaging, tPkg) },
    { id: "penalties",     label: "Штрафы и доплаты, руб",                        kind: "metric",  expense: true, values: tot(penalties,  tPen) },
    { id: "storage",       label: "Хранение, руб",                                kind: "metric",  expense: true, values: tot(storage,    tStr) },
    { id: "storage_pct",   label: "% хранения",                                   kind: "percent", values: tot(storage.map((s, i) => pct(s, revNoSpp[i]!)), pct(tStr, tRevNoSpp)) },
    { id: "other",         label: "Прочие удержания, руб",                        kind: "metric",  expense: true,  values: tot(other,      tOth) },
    { id: "withdraw_now",  label: "Вывести сейчас, руб",                          kind: "metric",  expense: true,  values: zeroArr },
    { id: "jem",           label: "Подписка «Джем», руб",                         kind: "metric",  expense: true,  values: zeroArr },
    { id: "transit",       label: "Транзитные поставки, руб",                     kind: "metric",  expense: true, values: zeroArr },
    { id: "acceptance",    label: "Платная приёмка, руб",                         kind: "metric",  expense: true, values: zeroArr },
    sep("sep2"),
    { id: "marginal",      label: "Маржинальный доход",                           kind: "metric",  values: tot(marginal,   tMarg) },
    { id: "marginal_pct",  label: "Рентабельность по МД, %",                      kind: "percent", values: tot(marginal.map((m, i) => pct(m, revNoSpp[i]!)), pct(tMarg, tRevNoSpp)) },
    sep("sep3"),
    { id: "ads",           label: "ВБ продвижение, руб",                          kind: "metric",  expense: true, values: tot(ads, tAds) },
    { id: "drr",           label: "ДРР, %",                                       kind: "percent", values: tot(ads.map((a, i) => pct(a, revNoSpp[i]!)), pct(tAds, tRevNoSpp)) },
    sep("sep4"),
    { id: "gross",         label: "Валовая прибыль",                              kind: "metric",  values: tot(gross,      tGross) },
    { id: "gross_pct",     label: "Рентабельность, %",                            kind: "percent", values: tot(gross.map((g, i) => pct(g, revNoSpp[i]!)), pct(tGross, tRevNoSpp)) },
    sep("sep5"),
    { id: "loan_transfer", label: "Перевод на баланс заёмщика (займ/кредит)",    kind: "metric",  expense: true, values: tot(weeks.map(() => 0), 0) },
    { id: "penalty_loan",  label: "Пени",                                         kind: "metric",  expense: true, values: tot(weeks.map(() => 0), 0) },
  ];

  return { weeks, rows, warehouseByWeek: Object.fromEntries(weeks.map((w, i) => [w.weekStart, packaging[i] ?? 0])) };
}

const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Сводка" },
  { id: "detail", label: "Свод по дате продажи" },
  { id: "risks", label: "Риски и задачи" },
  { id: "forecast", label: "Прогноз" },
  { id: "calendar", label: "Платёжный календарь" },
];

function getTotal(rows: OpiuTableRow[], id: string): number | null {
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return row.values[row.values.length - 1] ?? null;
}

function fmtK(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(".", ",") + " млн";
  if (a >= 1_000) return Math.round(v / 1_000) + " тыс";
  return Math.round(v).toLocaleString("ru-RU");
}

/* ── KPI tile ── */
function KpiTile({
  label, value, sub, accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "good" | "bad";
}) {
  const valColor =
    accent === "good" ? "text-[#1f9d55]" : accent === "bad" ? "text-[#d4423b]" : "text-[#1a2138]";
  return (
    <div className="bg-white border border-[#e6e9f2] rounded-xl p-4 shadow-sm hover:-translate-y-px transition-transform">
      <div className="text-[10px] text-[#6b7390] uppercase tracking-wider font-semibold leading-tight">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1.5 tabular-nums ${valColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#6b7390] mt-1">{sub}</div>}
    </div>
  );
}

/* ── P&L Waterfall SVG ── */
function WaterfallChart({ rows }: { rows: OpiuTableRow[] }) {
  const rev = getTotal(rows, "rev_no_spp") ?? 0;
  if (rev === 0) return <div className="h-32 flex items-center justify-center text-sm text-[#6b7390]">Нет данных</div>;

  const steps = [
    { label: "Выручка", value: getTotal(rows, "rev_no_spp") ?? 0, type: "income" as const },
    { label: "Комис.", value: Math.abs(getTotal(rows, "commission") ?? 0), type: "deduct" as const },
    { label: "Логист.", value: Math.abs(getTotal(rows, "logistics") ?? 0), type: "deduct" as const },
    { label: "Себест.", value: Math.abs(getTotal(rows, "cogs") ?? 0), type: "deduct" as const },
    { label: "Подгот.", value: Math.abs(getTotal(rows, "packaging") ?? 0), type: "deduct" as const },
    { label: "Прочие", value: Math.abs((getTotal(rows, "penalties") ?? 0) + (getTotal(rows, "storage") ?? 0) + (getTotal(rows, "other") ?? 0)), type: "deduct" as const },
    { label: "МД", value: getTotal(rows, "marginal") ?? 0, type: "result" as const },
    { label: "Реклама", value: Math.abs(getTotal(rows, "ads") ?? 0), type: "deduct" as const },
    { label: "ВП", value: getTotal(rows, "gross") ?? 0, type: "result" as const },
  ];

  const W = 560, H = 180, PX = 28, PY = 18;
  const chartW = W - PX * 2;
  const chartH = H - PY;
  const colW = chartW / steps.length;
  const barW = colW * 0.6;
  const maxV = rev;
  const sc = chartH / maxV;

  let running = rev;
  const bars = steps.map((step, i) => {
    const x = PX + i * colW + (colW - barW) / 2;
    let barH: number, barY: number, color: string;

    if (step.type === "income") {
      barH = step.value * sc;
      barY = chartH - barH;
      running = step.value;
      color = "#1f9d55";
    } else if (step.type === "deduct") {
      barH = step.value * sc;
      barY = chartH - running * sc;
      running -= step.value;
      color = "#f47c6a";
    } else {
      // result bar
      barH = Math.abs(step.value) * sc;
      barY = chartH - Math.max(step.value, 0) * sc;
      color = step.value >= 0 ? "#4a3aff" : "#d4423b";
    }

    return { x, barH: Math.max(barH, 1), barY, color, step, running };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" className="block">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PX} x2={W - PX} y1={chartH - f * chartH} y2={chartH - f * chartH}
          stroke="#e6e9f2" strokeDasharray="4 3" />
      ))}
      {bars.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.barY} width={barW} height={b.barH} rx={3}
            fill={b.color} opacity={b.step.type === "deduct" ? 0.8 : 1} />
          <text x={b.x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="#6b7390">
            {b.step.label}
          </text>
          {b.barH > 14 && (
            <text x={b.x + barW / 2} y={b.barY - 3} textAnchor="middle" fontSize={9}
              fill={b.step.type === "deduct" ? "#d4423b" : b.color} fontWeight="600">
              {fmtK(b.step.type === "deduct" ? -b.step.value : b.step.value)}
            </text>
          )}
        </g>
      ))}
      <line x1={PX} x2={W - PX} y1={chartH} y2={chartH} stroke="#e6e9f2" />
    </svg>
  );
}

/* ── Weekly trend SVG ── */
function WeeklyTrend({ weeks, rows }: { weeks: OpiuReport["weeks"]; rows: OpiuTableRow[] }) {
  const revRow = rows.find((r) => r.id === "rev_no_spp");
  const grossRow = rows.find((r) => r.id === "gross");
  if (!revRow || !grossRow || weeks.length < 2) return null;

  const revVals = revRow.values.slice(0, -1) as number[];
  const grossVals = grossRow.values.slice(0, -1) as number[];

  const W = 400, H = 160, PX = 10, PY = 16;
  const chartW = W - PX * 2;
  const chartH = H - PY * 2 - 14;
  const all = [...revVals, ...grossVals].filter((v) => v != null);
  const maxV = Math.max(...all, 1);
  const minV = Math.min(...all, 0);
  const range = maxV - minV || 1;
  const n = weeks.length;

  const toX = (i: number) => PX + (n < 2 ? chartW / 2 : (i / (n - 1)) * chartW);
  const toY = (v: number) => PY + chartH - ((v - minV) / range) * chartH;

  const poly = (vals: number[]) =>
    vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="block">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={PX} x2={W - PX} y1={toY(minV + f * range)} y2={toY(minV + f * range)}
          stroke="#e6e9f2" strokeDasharray="3 3" />
      ))}
      <polyline points={poly(revVals)} fill="none" stroke="#4a3aff" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={poly(grossVals)} fill="none" stroke="#1f9d55" strokeWidth={2} strokeLinejoin="round" />
      {revVals.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill="#4a3aff" />)}
      {grossVals.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill="#1f9d55" />)}
      {weeks.map((w, i) => (
        <text key={i} x={toX(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="#6b7390">
          {w.label}
        </text>
      ))}
    </svg>
  );
}

/* ── Detail P&L table ── */
function DetailTable({
  report, savingWeek, onSave,
}: {
  report: OpiuReport;
  savingWeek: string | null;
  onSave: (weekStart: string, raw: string) => Promise<void>;
}) {
  function cellColor(value: number | null, row: Pick<OpiuTableRow, "kind" | "expense" | "id">): string {
    if (value == null || row.kind === "separator") return "text-[#6b7390]";
    if (row.kind === "percent") return "text-[#6b7390]";
    if (row.expense) return value > 0 ? "text-[#d4423b]" : "text-[#1a2138]";
    if (row.id === "marginal" || row.id === "gross") {
      return value > 0 ? "text-[#1f9d55] font-semibold" : value < 0 ? "text-[#d4423b] font-semibold" : "text-[#6b7390]";
    }
    return value > 0 ? "text-[#1a2138]" : value < 0 ? "text-[#d4423b]" : "text-[#6b7390]";
  }

  function fmtCell(value: number | null, row: Pick<OpiuTableRow, "kind" | "expense">): string {
    if (value == null) return "—";
    if (row.kind === "percent") return formatPct(value);
    return formatRub(row.expense ? Math.abs(value) : value);
  }

  const totalIdx = report.weeks.length;

  return (
    <div className="overflow-x-auto rounded-xl border border-[#e6e9f2] bg-white shadow-sm">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#fafbfd] border-b border-[#e6e9f2]">
            <th className="sticky left-0 z-10 bg-[#fafbfd] min-w-[200px] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">
              Показатель
            </th>
            {report.weeks.map((w) => (
              <th key={w.weekStart} className="w-[120px] px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">
                {w.label}
              </th>
            ))}
            <th className="w-[130px] px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#1a2138]">
              Итого
            </th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            if (row.kind === "separator") {
              return (
                <tr key={row.id}>
                  <td colSpan={totalIdx + 2} className="h-px bg-[#f4f6fb] border-y border-[#e6e9f2]" />
                </tr>
              );
            }
            const isPercent = row.kind === "percent";
            const isResult = row.id === "marginal" || row.id === "gross";
            const total = row.values[totalIdx] ?? null;

            return (
              <tr key={row.id}
                className={`border-b border-[#e6e9f2] transition-colors hover:bg-[#fafbff] ${isResult ? "bg-[#f8f9ff]" : ""}`}>
                <td className={`sticky left-0 z-10 bg-inherit px-4 py-2.5 ${
                  isPercent ? "text-xs text-[#6b7390] pl-8" : isResult ? "font-semibold text-[#1a2138]" : "text-[#1a2138]"
                }`}>
                  {row.label}
                </td>
                {row.values.slice(0, totalIdx).map((val, i) => {
                  const week = report.weeks[i];
                  if (row.editable && week) {
                    return (
                      <td key={week.weekStart} className="px-2 py-1.5 text-right">
                        <input
                          key={`${week.weekStart}-${val}`}
                          type="text"
                          defaultValue={val != null ? String(Math.round(val)) : "0"}
                          disabled={savingWeek === week.weekStart}
                          onBlur={(e) => {
                            const next = e.target.value;
                            const prev = val != null ? String(Math.round(val)) : "0";
                            if (next !== prev) void onSave(week.weekStart, next);
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="w-full rounded border border-[#e6e9f2] bg-white px-2 py-1 text-right text-sm text-[#1a2138] focus:border-[#4a3aff] focus:outline-none"
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={week?.weekStart ?? i}
                      className={`px-3 py-2.5 text-right tabular-nums ${isPercent ? "text-xs" : ""} ${cellColor(val, row)}`}>
                      {fmtCell(val, row)}
                    </td>
                  );
                })}
                <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${isPercent ? "text-xs" : ""} ${cellColor(total, row)}`}>
                  {fmtCell(total, row)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Risk map card ── */
function RiskCard({
  icon, count, title, desc, items, accent,
}: {
  icon: string;
  count: number;
  title: string;
  desc: string;
  items: SkuRisk[];
  accent: "red" | "yellow" | "blue" | "green" | "gray";
}) {
  const border: Record<string, string> = {
    red:    "border-[#fca5a5] bg-[#fff5f5]",
    yellow: "border-[#fcd34d] bg-[#fffbeb]",
    blue:   "border-[#93c5fd] bg-[#eff6ff]",
    green:  "border-[#86efac] bg-[#f0fdf4]",
    gray:   "border-[#e6e9f2] bg-white",
  };
  const countColor: Record<string, string> = {
    red: "text-[#d4423b]", yellow: "text-[#d68a00]",
    blue: "text-[#2a6df4]", green: "text-[#1f9d55]", gray: "text-[#1a2138]",
  };

  return (
    <div className={`rounded-xl border-2 p-5 ${border[accent]}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-3xl font-bold ${countColor[accent]}`}>{count}</div>
      <div className="font-semibold text-[#1a2138] text-sm mt-1">{title}</div>
      <div className="text-xs text-[#6b7390] mt-1 leading-relaxed">{desc}</div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {items.slice(0, 6).map((s) => (
            <span key={s.nm} className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-[#e6e9f2] text-[#1a2138] font-medium">
              {s.name.length > 18 ? s.name.slice(0, 18) + "…" : s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Задачи РОПу ── */
function RopuTask({
  num, icon, title, desc, items, accent,
}: {
  num: number;
  icon: string;
  title: string;
  desc: string;
  items: SkuRisk[];
  accent: "red" | "yellow" | "green";
}) {
  const left: Record<string, string> = {
    red: "border-l-[#d4423b]", yellow: "border-l-[#d68a00]", green: "border-l-[#1f9d55]",
  };
  const numBg: Record<string, string> = {
    red: "bg-[#d4423b]", yellow: "bg-[#d68a00]", green: "bg-[#1f9d55]",
  };

  return (
    <div className={`bg-white border border-[#e6e9f2] border-l-4 ${left[accent]} rounded-xl p-5`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center ${numBg[accent]}`}>
          {num}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[#1a2138]">{icon} {title}</div>
          <div className="text-xs text-[#6b7390] mt-1 leading-relaxed">{desc}</div>
          {items.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {items.slice(0, 6).map((s) => (
                <span key={s.nm} className="text-[11px] px-2 py-0.5 rounded-md bg-[#f4f6fb] border border-[#e6e9f2] text-[#1a2138] font-medium">
                  {s.name.length > 20 ? s.name.slice(0, 20) + "…" : s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Вкладка Риски ── */
function RisksTab({ usingMock }: { usingMock: boolean }) {
  const skus = MOCK_SKUS;
  const { losers, redZone, frozen, highDrr, noTraffic, aItems } = deriveRisks(skus);

  const totalLoss = losers.reduce((s, x) => s + x.profit, 0);
  const frozenRub = frozen.reduce((s, x) => s + x.revenue * 0.3, 0); // грубая оценка

  return (
    <div className="space-y-6">
      {usingMock && (
        <div className="flex items-center gap-3 rounded-lg border border-[#d68a00] bg-[#fff4dd] px-4 py-3 text-sm text-[#7a4f00]">
          <span>⚠️</span>
          <span><strong>Тестовые данные.</strong> Риски рассчитаны на примерных SKU. После восстановления токена WB появятся реальные товары.</span>
        </div>
      )}

      {/* Карта рисков */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">⚠️</span>
          <h2 className="text-base font-semibold text-[#1a2138]">Карта рисков</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <RiskCard
            icon="🪲" count={losers.length} accent="red"
            title="Убыточные товары"
            desc={`Отрицательная маржа. Суммарный убыток: ${fmtK(totalLoss)} ₽. Поднять цену выше точки безубыточности или остановить поставки.`}
            items={losers}
          />
          <RiskCard
            icon="🔴" count={redZone.length} accent="red"
            title="Красная зона плана (<50%)"
            desc="Значимые товары с планом >150к ₽, выполняют <50%. Проверить позиции в выдаче и ставки рекламы."
            items={redZone}
          />
          <RiskCard
            icon="❄️" count={frozen.length} accent="blue"
            title="Замороженный капитал (>150 дн)"
            desc={`Остатки с оборачиваемостью >150 дней. Оценка замороженных средств: ~${fmtK(frozenRub)} ₽. Акция, снижение цены или вывод из матрицы.`}
            items={frozen}
          />
          <RiskCard
            icon="📣" count={highDrr.length} accent="yellow"
            title="Высокий ДРР >12%"
            desc="Реклама слишком дорогая. Снизить ставки, перераспределить бюджет на товары с ДРР <6%."
            items={highDrr}
          />
          <RiskCard
            icon="🚫" count={noTraffic.length} accent="gray"
            title="Нет трафика (есть план)"
            desc="Товары с планом, но нулевые заказы. Не раскрываются — проверить контент, цену, наличие остатков."
            items={noTraffic}
          />
          <RiskCard
            icon="✅" count={aItems.length} accent="green"
            title="А-товары (80% объёма)"
            desc="Ядро бизнеса. Удерживать позиции, не допускать стокаута, масштабировать рекламу."
            items={aItems}
          />
        </div>
      </div>

      {/* Задачи РОПу */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🎯</span>
          <h2 className="text-base font-semibold text-[#1a2138]">Задачи РОПу — приоритизированный список</h2>
        </div>
        <div className="space-y-3">
          {losers.length > 0 && (
            <RopuTask num={1} accent="red" icon="🪲"
              title="Убыточные товары — решение сегодня"
              desc={`${losers.length} товаров с отрицательной маржой. Суммарный убыток: ${fmtK(totalLoss)} ₽. Поднять цену выше точки безубыточности или остановить поставки.`}
              items={losers}
            />
          )}
          {redZone.length > 0 && (
            <RopuTask num={2} accent="red" icon="🔻"
              title="Восстановить трафик на упавшие товары"
              desc={`${redZone.length} товаров в красной зоне плана. Причина — падение заказов, а не рост расходов. Проверить позиции в выдаче и ставки рекламы.`}
              items={redZone}
            />
          )}
          {highDrr.length > 0 && (
            <RopuTask num={3} accent="yellow" icon="📣"
              title="Оптимизировать рекламу (ДРР >12%)"
              desc={`${highDrr.length} товаров с завышенным ДРР. Снизить ставки, перераспределить бюджет на товары с ДРР <6%.`}
              items={highDrr}
            />
          )}
          {frozen.length > 0 && (
            <RopuTask num={4} accent="yellow" icon="❄️"
              title={`Распродать товары с оборотом >150 дней`}
              desc={`${frozen.length} товаров с замороженным капиталом (~${fmtK(frozenRub)} ₽). Акция, снижение цены или вывод из матрицы.`}
              items={frozen}
            />
          )}
          {noTraffic.length > 0 && (
            <RopuTask num={5} accent="yellow" icon="🚫"
              title="Разобрать товары без трафика"
              desc={`${noTraffic.length} товаров с планом, но нулевыми заказами. Не раскрываются — проверить контент, цену, наличие остатков на складе.`}
              items={noTraffic}
            />
          )}
          {aItems.length > 0 && (
            <RopuTask num={6} accent="green" icon="🚀"
              title="Усилить лидеров роста"
              desc={`${aItems.length} А-товаров дают основной объём прибыли. Масштабировать рекламный бюджет, не допускать стокаута, расширять ассортимент.`}
              items={aItems}
            />
          )}
        </div>
      </div>

      {/* Итоговый стол SKU */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">📋</span>
          <h2 className="text-base font-semibold text-[#1a2138]">Все товары</h2>
        </div>
        <div className="bg-white border border-[#e6e9f2] rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#fafbfd] border-b border-[#e6e9f2]">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">Товар</th>
                <th className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">ABC</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">Заказы ₽</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">% плана</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">Прибыль ₽</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">Маржа %</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">ДРР %</th>
                <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#6b7390]">Оборот дн.</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const isLoss = s.profit < 0;
                const isHighDrr = (s.drr ?? 0) > 12;
                const isFrozen = (s.turnoverDays ?? 0) > 150;
                const planBad = (s.planPct ?? 100) < 50;
                const abcColors: Record<string, string> = {
                  A: "bg-[#e6f6ec] text-[#1f9d55]",
                  B: "bg-[#e8efff] text-[#2a6df4]",
                  C: "bg-[#fff4dd] text-[#d68a00]",
                  D: "bg-[#fdecea] text-[#d4423b]",
                };
                return (
                  <tr key={s.nm} className={`border-b border-[#e6e9f2] hover:bg-[#fafbff] transition-colors ${isLoss ? "bg-[#fff8f8]" : ""}`}>
                    <td className="px-4 py-2.5 text-[#1a2138] font-medium max-w-[200px] truncate">{s.name}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${abcColors[s.abc]}`}>{s.abc}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#1a2138]">{fmtK(s.revenue)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${planBad ? "text-[#d4423b]" : (s.planPct ?? 0) >= 100 ? "text-[#1f9d55]" : "text-[#d68a00]"}`}>
                      {s.planPct != null ? `${s.planPct}%` : "—"}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${isLoss ? "text-[#d4423b]" : "text-[#1f9d55]"}`}>
                      {fmtK(s.profit)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${isLoss ? "text-[#d4423b]" : "text-[#1a2138]"}`}>
                      {s.margin != null ? `${s.margin}%` : "—"}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${isHighDrr ? "text-[#d4423b] font-semibold" : "text-[#1a2138]"}`}>
                      {s.drr != null ? `${s.drr}%` : "—"}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${isFrozen ? "text-[#2a6df4] font-semibold" : "text-[#1a2138]"}`}>
                      {s.turnoverDays != null ? `${s.turnoverDays} дн.` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Stub screens ── */
function ComingSoon({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-5xl mb-5">{icon}</div>
      <div className="text-lg font-semibold text-[#1a2138] mb-2">{title}</div>
      <div className="text-sm text-[#6b7390] max-w-sm leading-relaxed">{desc}</div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Main page
══════════════════════════════════════════ */
export function OpiuPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [month, setMonth] = useState(currentMonthParam);
  const [data, setData] = useState<OpiuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWeek, setSavingWeek] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchReport = useCallback(async (m: string, refresh = false) => {
    const params = new URLSearchParams({ month: m });
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu?${params}`);
    const json = (await res.json()) as OpiuResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUsingMock(false);
    fetchReport(month)
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => {
        if (!cancelled) {
          setData({ month, report: buildMockReport(month), timestamp: new Date().toISOString() });
          setUsingMock(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, fetchReport]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setUsingMock(false);
      setData(await fetchReport(month, true));
    } catch {
      setData({ month, report: buildMockReport(month), timestamp: new Date().toISOString() });
      setUsingMock(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleWarehouseSave = async (weekStart: string, raw: string) => {
    const amount = Number(raw.replace(/\s/g, "").replace(",", ".")) || 0;
    setSavingWeek(weekStart);
    try {
      const res = await fetch("/api/opiu/warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, weekStart, amount }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Ошибка сохранения");
      }
      setData(await fetchReport(month));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSavingWeek(null);
    }
  };

  const report = data?.report;
  const tot = (id: string) => (report ? getTotal(report.rows, id) : null);

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      {/* ── Top controls ── */}
      <div className="bg-white border-b border-[#e6e9f2] px-6 py-3 flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-[#e6e9f2] px-3 py-2 text-sm text-[#1a2138] focus:border-[#4a3aff] focus:outline-none"
        />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e6e9f2] bg-white px-3 py-2 text-sm font-medium text-[#1a2138] hover:border-[#4a3aff] hover:text-[#4a3aff] transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </button>
        {data?.timestamp && !loading && (
          <span className="text-xs text-[#6b7390]">
            {formatTime(data.timestamp)}
            {data.meta ? ` · ${data.meta.salesRows.toLocaleString("ru-RU")} строк` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 rounded-lg bg-[#e6f6ec] px-3 py-1.5 text-xs font-medium text-[#1f9d55]">
          <span className="w-2 h-2 rounded-full bg-[#1f9d55]" />
          Синхронизировано
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-6 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="px-6 pt-5 pb-10">
        {/* ── Mock banner ── */}
        {usingMock && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#d68a00] bg-[#fff4dd] px-4 py-3 text-sm text-[#7a4f00]">
            <span className="text-base">⚠️</span>
            <span>
              <strong>Тестовые данные.</strong> API WB временно недоступен — показаны примерные цифры для разработки дизайна. Реальные данные появятся, когда токен будет восстановлен.
            </span>
          </div>
        )}

        {/* ── Tabs ── */}
        <nav className="flex border-b border-[#e6e9f2] mb-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors rounded-t-md ${
                tab === t.id
                  ? "text-[#1a2138]"
                  : "text-[#6b7390] hover:text-[#1a2138] hover:bg-black/[0.02]"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-[#4a3aff] rounded-t" />
              )}
            </button>
          ))}
        </nav>

        {/* ── Loading skeleton ── */}
        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-white border border-[#e6e9f2]" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="h-56 rounded-xl bg-white border border-[#e6e9f2]" />
              <div className="h-56 rounded-xl bg-white border border-[#e6e9f2]" />
            </div>
          </div>
        ) : report ? (
          <>
            {/* ════ СВОДКА ════ */}
            {tab === "summary" && (
              <div className="space-y-4">
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  <KpiTile label="Заказы" value={fmtK(tot("orders"))} sub="руб." />
                  <KpiTile label="Выручка без СПП" value={fmtK(tot("rev_no_spp"))} />
                  <KpiTile label="Себестоимость" value={fmtK(tot("cogs"))} accent="bad" />
                  <KpiTile label="Комиссия WB" value={fmtK(tot("commission"))} accent="bad" />
                  <KpiTile label="Логистика" value={fmtK(tot("logistics"))} accent="bad" />
                  <KpiTile label="Реклама" value={fmtK(tot("ads"))} accent="bad" />
                  <KpiTile
                    label="Валовая прибыль"
                    value={fmtK(tot("gross"))}
                    accent={(tot("gross") ?? 0) >= 0 ? "good" : "bad"}
                    sub={tot("gross_pct") != null ? formatPct(tot("gross_pct")!) : undefined}
                  />
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Waterfall */}
                  <div className="bg-white border border-[#e6e9f2] rounded-xl shadow-sm">
                    <div className="px-5 py-4 border-b border-[#e6e9f2]">
                      <div className="text-sm font-semibold text-[#1a2138]">P&L-водопад</div>
                      <div className="text-xs text-[#6b7390] mt-0.5">от выручки к валовой прибыли</div>
                    </div>
                    <div className="p-5">
                      <WaterfallChart rows={report.rows} />
                      <div className="mt-2 flex gap-4 text-[11px] text-[#6b7390]">
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#1f9d55] mr-1 align-[-1px]" />Выручка</span>
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#f47c6a] mr-1 align-[-1px]" />Расходы</span>
                        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#4a3aff] mr-1 align-[-1px]" />Прибыль</span>
                      </div>
                    </div>
                  </div>

                  {/* Weekly trend */}
                  <div className="bg-white border border-[#e6e9f2] rounded-xl shadow-sm">
                    <div className="px-5 py-4 border-b border-[#e6e9f2]">
                      <div className="text-sm font-semibold text-[#1a2138]">Динамика по неделям</div>
                      <div className="text-xs text-[#6b7390] mt-0.5">выручка и валовая прибыль</div>
                    </div>
                    <div className="px-5 pt-3 pb-1 flex gap-4 text-xs text-[#1a2138]">
                      <span>
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#4a3aff] mr-1.5 align-[-1px]" />
                        Выручка
                      </span>
                      <span>
                        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1f9d55] mr-1.5 align-[-1px]" />
                        Валовая прибыль
                      </span>
                    </div>
                    <div className="px-4 pb-4 pt-1">
                      <WeeklyTrend weeks={report.weeks} rows={report.rows} />
                    </div>
                  </div>
                </div>

                {/* Tip */}
                <div className="flex gap-3 px-4 py-3.5 bg-[#ece9ff] border border-dashed border-[#4a3aff] rounded-xl">
                  <span className="text-xl text-[#4a3aff] shrink-0">💡</span>
                  <div>
                    <div className="text-sm font-semibold text-[#1a2138]">Формула</div>
                    <div className="text-xs text-[#2c3454] mt-1 leading-relaxed">
                      МД = Выручка − Себестоимость − Склад − Комиссия − Логистика − Прочие. Валовая прибыль = МД − Реклама.
                      Себестоимость и склад вводятся вручную во вкладке «Свод по дате продажи».
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ════ ДЕТАЛЬНО P&L ════ */}
            {tab === "detail" && (
              <DetailTable
                report={report}
                savingWeek={savingWeek}
                onSave={handleWarehouseSave}
              />
            )}

            {/* ════ РИСКИ И ЗАДАЧИ ════ */}
            {tab === "risks" && <RisksTab usingMock={usingMock} />}

            {/* ════ ПРОГНОЗ ════ */}
            {tab === "forecast" && (
              <ComingSoon
                icon="🔮"
                title="Прогноз — в разработке"
                desc="Здесь появятся сценарии на следующий месяц, калькулятор «Что-если» и риски."
              />
            )}

            {/* ════ ПЛАТЁЖНЫЙ КАЛЕНДАРЬ ════ */}
            {tab === "calendar" && (
              <ComingSoon
                icon="📅"
                title="Платёжный календарь — в разработке"
                desc="Здесь будет календарь поступлений и списаний с привязкой к выплатам WB."
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
