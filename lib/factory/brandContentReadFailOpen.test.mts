import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const brandKit = readFileSync("app/api/factory/brand-kit/route.ts", "utf8");
const contentIndex = readFileSync("app/api/factory/content-index/route.ts", "utf8");

const brandGet = brandKit.split("export async function POST")[0] || brandKit;
const contentGet = contentIndex.split("export async function POST")[1]?.split("// GET")[1] || contentIndex;

ok(/brands: emptyBrands\(\), warning: "Supabase не настроен — бренд-киты временно пустые"/.test(brandGet), "brand-kit list read has missing-db fallback");
ok(/warning: "миграция brand_kits не применена"/.test(brandGet), "brand-kit list treats missing migration as warning");
ok(/partial: true,[\s\S]*warning: "чтение бренд-кита упало: "/.test(brandGet), "brand-kit crash path is warning-only");
ok(!/чтение бренд-кита упало[\s\S]*status:\s*500/.test(brandGet), "brand-kit GET no longer returns HTTP 500");
ok(/warning: "Supabase не настроен — индекс контента временно пустой"/.test(contentGet), "content-index GET has missing-db fallback");
ok(/warning: "агрегаты индекса контента временно недоступны: "/.test(contentGet), "content-index aggregate errors are warning-only");
ok(!/чтение индекса контента упало[\s\S]*status:\s*500/.test(contentGet), "content-index GET no longer returns HTTP 500");

if (failed) process.exit(1);
console.log(`brandContentReadFailOpen: ${passed} passed, ${failed} failed`);
