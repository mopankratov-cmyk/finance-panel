import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load env from .env.local without printing secrets
function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        )
          v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v;
      }
    }
  } catch (e) {
    console.error("env load failed", (e as Error).message);
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const JACKET_TERMS = [
  "куртк",
  "ветровк",
  "пухов",
  "демисезон",
  "парк",
  "пальто",
  "плащ",
  "жилет",
  "ветров",
  "анорак",
  "бомбер",
];

async function main() {
  // 1) Entities / brands in product_costs
  const { data: costs, error: e1 } = await supabase
    .from("product_costs")
    .select("article, brand, entity, name, cost_rub, warehouse_expenses");
  if (e1) {
    console.error("product_costs error:", e1.message);
  } else {
    const byEntity = new Map<string, number>();
    const byBrand = new Map<string, number>();
    for (const c of costs ?? []) {
      byEntity.set(c.entity, (byEntity.get(c.entity) ?? 0) + 1);
      byBrand.set(c.brand, (byBrand.get(c.brand) ?? 0) + 1);
    }
    console.log("=== product_costs: total rows =", (costs ?? []).length);
    console.log("--- by entity ---");
    for (const [k, v] of [...byEntity.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${v.toString().padStart(4)}  ${k}`);
    console.log("--- by brand ---");
    for (const [k, v] of [...byBrand.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${v.toString().padStart(4)}  ${k}`);

    // 2) Jacket-like products by name
    const jackets = (costs ?? []).filter((c) =>
      JACKET_TERMS.some((t) => String(c.name).toLowerCase().includes(t)),
    );
    console.log("\n=== JACKET-LIKE products in product_costs =", jackets.length);
    for (const j of jackets.slice(0, 60))
      console.log(
        `  ${j.article}  | ${j.brand} | ${j.entity} | cost=${j.cost_rub} wh=${j.warehouse_expenses} | ${j.name}`,
      );
  }

  // 3) wb_orders: date range + distinct article prefixes + volume
  const { data: ordMinMax } = await supabase
    .from("wb_orders")
    .select("date")
    .order("date", { ascending: true })
    .limit(1);
  const { data: ordMax } = await supabase
    .from("wb_orders")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  const { count: ordCount } = await supabase
    .from("wb_orders")
    .select("*", { count: "exact", head: true });
  console.log("\n=== wb_orders ===");
  console.log("  earliest:", ordMinMax?.[0]?.date, "latest:", ordMax?.[0]?.date);
  console.log("  total rows:", ordCount);

  // distinct supplier_article prefixes
  const { data: arts } = await supabase
    .from("wb_orders")
    .select("supplier_article")
    .limit(50000);
  const prefixes = new Map<string, number>();
  for (const a of arts ?? []) {
    const sa = String(a.supplier_article ?? "");
    const p = sa.replace(/[0-9].*$/, "").slice(0, 6) || "(empty)";
    prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
  }
  console.log("--- wb_orders supplier_article prefixes (top 40) ---");
  for (const [k, v] of [...prefixes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40))
    console.log(`  ${v.toString().padStart(6)}  ${k}`);

  // 4) wb_sales date range + count
  const { count: salesCount } = await supabase
    .from("wb_sales")
    .select("*", { count: "exact", head: true });
  const { data: sMin } = await supabase
    .from("wb_sales")
    .select("date")
    .order("date", { ascending: true })
    .limit(1);
  const { data: sMax } = await supabase
    .from("wb_sales")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);
  console.log("\n=== wb_sales ===");
  console.log("  earliest:", sMin?.[0]?.date, "latest:", sMax?.[0]?.date);
  console.log("  total rows:", salesCount);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
