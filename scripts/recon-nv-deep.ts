import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}
loadEnv();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// paginate helper (Supabase caps at 1000 rows/req)
async function fetchAll(table: string, cols: string, filter: (q: any) => any) {
  const out: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    let q = supabase.from(table).select(cols).range(from, from + page - 1);
    q = filter(q);
    const { data, error } = await q;
    if (error) { console.error(table, "err", error.message); break; }
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

const ym = (d: string) => String(d).slice(0, 7);

async function main() {
  // ALL NV- orders
  const orders = await fetchAll("wb_orders", "nm_id,supplier_article,date,total_price,discount_percent,finished_price,is_cancel",
    (q) => q.ilike("supplier_article", "NV-%"));
  // ALL NV- sales (buyouts) — wb_sales has no supplier_article, join by nm_id set
  const nmIds = [...new Set(orders.map((o) => Number(o.nm_id)))];
  console.log("NV- distinct nm_id:", nmIds.length, "| total orders rows:", orders.length);

  // fetch sales for those nm_ids (chunk the IN list)
  const sales: any[] = [];
  for (let i = 0; i < nmIds.length; i += 200) {
    const chunk = nmIds.slice(i, i + 200);
    const part = await fetchAll("wb_sales", "nm_id,date,for_pay,finished_price,price_with_disc",
      (q) => q.in("nm_id", chunk));
    sales.push(...part);
  }
  console.log("NV- sales(buyout) rows:", sales.length);

  // Monthly: orders (non-cancel) count+rub, sales count+rub+for_pay
  type M = { oc: number; orub: number; bc: number; brub: number; pay: number };
  const months = new Map<string, M>();
  const mget = (k: string) => { let e = months.get(k); if (!e) { e = { oc: 0, orub: 0, bc: 0, brub: 0, pay: 0 }; months.set(k, e); } return e; };
  for (const o of orders) {
    if (o.is_cancel) continue;
    const e = mget(ym(o.date));
    e.oc++; e.orub += Number(o.finished_price ?? 0);
  }
  for (const s of sales) {
    const e = mget(ym(s.date));
    e.bc++; e.brub += Number(s.finished_price ?? 0); e.pay += Number(s.for_pay ?? 0);
  }
  console.log("\n=== NV- MONTHLY ===");
  console.log("month   | orders  ordersRub   buyouts  buyoutRub   payout   buyout%  avgOrd  effTake%");
  for (const k of [...months.keys()].sort()) {
    const e = months.get(k)!;
    const buyPct = e.oc ? (e.bc / e.oc) * 100 : 0;
    const avgOrd = e.oc ? e.orub / e.oc : 0;
    const effTake = e.brub ? (1 - e.pay / e.brub) * 100 : 0; // WB take vs buyout revenue
    console.log(
      `${k} | ${String(e.oc).padStart(6)} ${Math.round(e.orub).toString().padStart(10)}  ${String(e.bc).padStart(6)} ${Math.round(e.brub).toString().padStart(10)} ${Math.round(e.pay).toString().padStart(9)}  ${buyPct.toFixed(0).padStart(5)}%  ${Math.round(avgOrd).toString().padStart(5)}   ${effTake.toFixed(1).padStart(5)}%`,
    );
  }

  // Totals
  const T = [...months.values()].reduce((a, e) => ({ oc: a.oc + e.oc, orub: a.orub + e.orub, bc: a.bc + e.bc, brub: a.brub + e.brub, pay: a.pay + e.pay }), { oc: 0, orub: 0, bc: 0, brub: 0, pay: 0 });
  console.log("\n=== NV- TOTALS (Jan–Jun 2026) ===");
  console.log("  orders(non-cancel):", T.oc, "| ordersRub:", Math.round(T.orub));
  console.log("  buyouts:", T.bc, "| buyoutRub:", Math.round(T.brub), "| payout(for_pay):", Math.round(T.pay));
  console.log("  buyout rate:", (T.oc ? (T.bc / T.oc) * 100 : 0).toFixed(1) + "%");
  console.log("  avg order price:", Math.round(T.oc ? T.orub / T.oc : 0));
  console.log("  avg buyout price:", Math.round(T.bc ? T.brub / T.bc : 0));
  console.log("  effective WB take (1 - payout/buyoutRub):", (T.brub ? (1 - T.pay / T.brub) * 100 : 0).toFixed(1) + "%");

  // Per-model price tiers → classify ветровка vs куртка by avg price
  const byModel = new Map<string, { cnt: number; sum: number; min: number; max: number }>();
  for (const o of orders) {
    if (o.is_cancel) continue;
    // model = NV-XXX (strip color suffix after last dash)
    const a = String(o.supplier_article);
    const model = a.replace(/-\d+$/, "");
    const fp = Number(o.finished_price ?? 0);
    const e = byModel.get(model) ?? { cnt: 0, sum: 0, min: 1e9, max: 0 };
    e.cnt++; e.sum += fp; e.min = Math.min(e.min, fp); e.max = Math.max(e.max, fp);
    byModel.set(model, e);
  }
  console.log("\n=== NV- by MODEL (price tier) ===");
  for (const [m, e] of [...byModel.entries()].sort((a, b) => b[1].cnt - a[1].cnt))
    console.log(`  ${m.padEnd(10)} cnt=${String(e.cnt).padStart(5)}  avg=${Math.round(e.sum / e.cnt).toString().padStart(6)}  min=${Math.round(e.min)}  max=${Math.round(e.max)}`);

  // Overall price histogram (buyouts) to see куртка vs ветровка split
  const buckets = new Map<string, number>();
  for (const s of sales) {
    const p = Number(s.finished_price ?? 0);
    const b = p < 4000 ? "<4k" : p < 6000 ? "4-6k" : p < 8000 ? "6-8k" : p < 10000 ? "8-10k" : p < 12000 ? "10-12k" : ">12k";
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  console.log("\n=== NV- buyout price histogram ===");
  for (const b of ["<4k", "4-6k", "6-8k", "8-10k", "10-12k", ">12k"])
    console.log(`  ${b.padEnd(6)} ${buckets.get(b) ?? 0}`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
