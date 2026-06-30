// Product source picker fixtures. Run: npx tsx lib/factory/productSourcePicker.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const picker = readFileSync("lib/factory/productSourcePicker.ts", "utf8");
const builder = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/source-pick/route.ts", "utf8");

ok(/pickProductSource/.test(picker), "source picker exports pickProductSource");
ok(/articleForPath\("design", item\.path\) === article/.test(picker), "source picker scores article folder match");
ok(/service_or_cover/.test(picker), "source picker avoids service/cover files");
ok(/pickProductSource/.test(builder), "Product Twin builder can auto-pick source");
ok(/picked_disk_path/.test(builder), "Product Twin builder records picked disk source kind");
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "source-pick route is protected by existing job auth");

console.log("productSourcePicker: passed");

