import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/source-prep/backlog/route.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "source-prep backlog endpoint is operator/cron authorized");
ok(/maxDuration = 300/.test(route), "source-prep backlog gets enough time for fal image edit");
ok(/\.eq\("disk", "wb"\)/.test(route) && /\.eq\("kind", "image"\)/.test(route), "source-prep backlog starts from raw WB images only");
ok(/loadSourceReadiness/.test(route), "source-prep backlog checks current source readiness");
ok(/item\.readiness\?\.tier === "wb"/.test(route), "source-prep backlog only prepares WB-only articles");
ok(/prepareProductImage/.test(route), "source-prep backlog uses product prep pipeline");
ok(/dry_run/.test(route) && /apply/.test(route), "source-prep backlog supports dry-run before apply");
ok(/images_per_article/.test(route), "source-prep backlog caps images per article");

console.log("sourcePrepBacklogContract: passed");
