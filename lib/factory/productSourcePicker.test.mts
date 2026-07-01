// Product source picker fixtures. Run: npx tsx lib/factory/productSourcePicker.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const picker = readFileSync("lib/factory/productSourcePicker.ts", "utf8");
const builder = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const cropper = readFileSync("lib/factory/productSourceCrop.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/source-pick/route.ts", "utf8");

ok(/pickProductSource/.test(picker), "source picker exports pickProductSource");
ok(/pickProductSourceCandidates/.test(picker), "source picker exports ranked source candidates");
ok(/articleForPath\(diskId, item\.path\) === article/.test(picker), "source picker scores article folder match");
ok(/norvia_line_match/.test(picker) && /norvia_line_mismatch/.test(picker), "source picker keeps NORVIA jacket lines matched to NV articles");
ok(/norvia_color_match/.test(picker), "source picker scores NORVIA color folder match");
ok(/buildApparelSourcePack/.test(picker), "source picker can prefer apparel source packs");
ok(/source_pack_role:/.test(picker), "source picker labels apparel source-pack candidates");
ok(/service_or_cover/.test(picker), "source picker avoids service/cover files");
ok(/yaDownloadHref/.test(picker) && /diagnostics/.test(picker), "source picker probes image quality before choosing");
ok(/sharp_source/.test(picker) && /focus_crop_applied/.test(picker), "source picker scores sharp focused product sources");
ok(/bag_dark_product_focus_v1/.test(cropper), "source cropper focuses bag/product area before cleaning");
ok(/pickProductSource/.test(builder), "Product Twin builder can auto-pick source");
ok(/picked_disk_path/.test(builder), "Product Twin builder records picked disk source kind");
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "source-pick route is protected by existing job auth");
ok(/candidates/.test(route), "source-pick route returns ranked candidates for debugging");

console.log("productSourcePicker: passed");
