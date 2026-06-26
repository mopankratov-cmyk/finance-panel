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

const route = readFileSync("app/api/factory/products/route.ts", "utf8");
const studio = readFileSync("public/inferno/studio.html", "utf8");

ok(/warning: "каталог товаров временно недоступен: "/.test(route), "products route returns warning metadata on read failure");
ok(/count: 0, items: \[\]/.test(route), "products route preserves empty list contract on read failure");
ok(!/каталог товаров упал[\s\S]*status:\s*500/.test(route), "products route does not return HTTP 500 for read-only catalog failures");
ok(/S\.allProducts=Array\.isArray\(d\.items\)\?d\.items:\[\]/.test(studio), "Studio already tolerates empty products response");

if (failed) process.exit(1);
console.log(`productsFailOpen: ${passed} passed, ${failed} failed`);
