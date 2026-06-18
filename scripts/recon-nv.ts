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

async function main() {
  // NV- analysis: price distribution, count, date range, nm_ids
  const { data: nv } = await supabase
    .from("wb_orders")
    .select("nm_id, supplier_article, date, total_price, discount_percent, finished_price, is_cancel")
    .ilike("supplier_article", "NV-%")
    .order("date", { ascending: false })
    .limit(5000);
  const rows = nv ?? [];
  const prices = rows.map((r) => Number(r.finished_price ?? 0)).filter((x) => x > 0);
  prices.sort((a, b) => a - b);
  const sum = prices.reduce((s, x) => s + x, 0);
  const arts = new Map<string, { cnt: number; sum: number; nmids: Set<number> }>();
  for (const r of rows) {
    const a = String(r.supplier_article);
    const e = arts.get(a) ?? { cnt: 0, sum: 0, nmids: new Set() };
    e.cnt++; e.sum += Number(r.finished_price ?? 0); e.nmids.add(Number(r.nm_id));
    arts.set(a, e);
  }
  console.log("=== NV- orders ===");
  console.log("  rows:", rows.length, "| avg finished_price:", prices.length ? Math.round(sum / prices.length) : 0);
  console.log("  price min/median/max:", prices[0], prices[Math.floor(prices.length / 2)], prices[prices.length - 1]);
  console.log("--- distinct NV- articles (top 30 by count) ---");
  for (const [a, e] of [...arts.entries()].sort((x, y) => y[1].cnt - x[1].cnt).slice(0, 30))
    console.log(`  ${String(e.cnt).padStart(4)}  avg=${Math.round(e.sum / e.cnt).toString().padStart(6)}  ${a}  nmids=${[...e.nmids].slice(0,3).join(",")}`);

  // Top articles overall by revenue (any prefix) to see what the real money is
  const { data: allord } = await supabase
    .from("wb_orders")
    .select("supplier_article, finished_price, is_cancel")
    .gte("date", "2026-01-01")
    .limit(80000);
  const byArt = new Map<string, { cnt: number; sum: number }>();
  for (const r of allord ?? []) {
    if (r.is_cancel) continue;
    const a = String(r.supplier_article ?? "(none)");
    const e = byArt.get(a) ?? { cnt: 0, sum: 0 };
    e.cnt++; e.sum += Number(r.finished_price ?? 0);
    byArt.set(a, e);
  }
  console.log("\n=== TOP 25 articles by order revenue (all) ===");
  for (const [a, e] of [...byArt.entries()].sort((x, y) => y[1].sum - x[1].sum).slice(0, 25))
    console.log(`  rev=${Math.round(e.sum).toString().padStart(9)}  cnt=${String(e.cnt).padStart(5)}  avg=${Math.round(e.sum/e.cnt).toString().padStart(6)}  ${a}`);

  // planning_state contents
  const { data: plan, error: pe } = await supabase.from("planning_state").select("*").limit(20);
  console.log("\n=== planning_state ===", pe ? pe.message : `${(plan ?? []).length} rows`);
  for (const p of plan ?? []) console.log("  keys:", Object.keys(p).join(","), "| sample:", JSON.stringify(p).slice(0, 200));
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
