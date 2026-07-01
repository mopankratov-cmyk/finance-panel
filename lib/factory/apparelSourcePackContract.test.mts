// Apparel source pack contract. Run: npx tsx lib/factory/apparelSourcePackContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/apparelSourcePack.ts", "utf8");
const route = readFileSync("app/api/factory/product-twin/source-pack/route.ts", "utf8");

ok(/buildApparelSourcePack/.test(helper), "apparel source pack builder is exported");
ok(/ApparelSourceRole/.test(helper), "apparel source pack has typed roles");
ok(/clean_front/.test(helper) && /back/.test(helper) && /fabric_macro/.test(helper), "source pack covers required apparel roles");
ok(/raw_photoshoot/.test(helper), "source pack prefers raw NORVIA photoshoot frames");
ok(/poster_like/.test(helper), "source pack penalizes poster-like apparel sources");
ok(/product_truth/.test(helper), "source pack rows are written as product_truth assets");
ok(/product_source_pack/.test(helper), "source pack rows include structured lineage metadata");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "source-pack route is protected");
ok(/buildBagSourcePack/.test(route) && /bagSourcePackRows/.test(route), "source-pack route also supports bag source packs");
ok(/mode: "dry_run"/.test(route), "source-pack route defaults to dry-run");
ok(/sourcePackItems/.test(route) && /body\.articles/.test(route) && /body\.items/.test(route), "source-pack route supports bulk articles/items");
ok(/count: results\.length/.test(route) && /results/.test(route), "source-pack route returns bulk results");
ok(/pack: results\.length === 1/.test(route), "source-pack route preserves single-pack response convenience");
ok(/apply:true/.test(route), "source-pack route documents explicit apply");
ok(/нет строк source-pack для записи/.test(route), "source-pack route guards empty apply writes");
ok(/content_assets/.test(route) && /upsert/.test(route), "source-pack route writes rows by upsert");

console.log("apparelSourcePackContract: passed");
