import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/source-prep/backlog/route.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "source-prep backlog endpoint is operator/cron authorized");
ok(/maxDuration = 300/.test(route), "source-prep backlog gets enough time for fal image edit");
ok(/\.eq\("disk", "wb"\)/.test(route) && /\.eq\("kind", "image"\)/.test(route), "source-prep backlog starts from raw WB images only");
ok(/failedArticles/.test(route) && /source_prep_failed_at/.test(route) && /retry_failed/.test(route), "source-prep backlog skips failed WB articles unless explicitly retrying");
ok(/loadSourceReadiness/.test(route), "source-prep backlog checks current source readiness");
ok(/item\.readiness\?\.tier === "wb"/.test(route), "source-prep backlog only prepares WB-only articles");
ok(/prepareProductImage/.test(route), "source-prep backlog uses product prep pipeline");
ok(/dry_run/.test(route) && /apply/.test(route), "source-prep backlog supports dry-run before apply");
ok(/images_per_article/.test(route), "source-prep backlog caps images per article");
ok(/source_prep_prepared_at/.test(route), "source-prep backlog marks successful WB source rows");
ok(/rowsToMark = prepared\.length \? sourceRows : item\.assets/.test(route), "source-prep backlog marks every selected WB row when an article fails");

console.log("sourcePrepBacklogContract: passed");
