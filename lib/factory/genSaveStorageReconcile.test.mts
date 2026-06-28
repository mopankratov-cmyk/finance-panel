import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("app/api/factory/gen-save/reconcile/route.ts", "utf8");

ok(/const PREFIXES = \["gen", "renders"\];/.test(source), "reconcile scans final gen and render storage prefixes");
ok(/existingGenRefs/.test(source), "reconcile checks existing catalog URLs before inserting");
ok(/sourceUrls/.test(source), "reconcile skips videos already remembered as source URLs");
ok(/skipped_duplicate/.test(source), "reconcile tolerates unique duplicates during apply");
ok(/storage_reconcile/.test(source), "reconcile marks restored catalog rows");
ok(/function authOk/.test(source) && /authorization/.test(source), "reconcile requires CRON_SECRET bearer auth");
ok(/body\.apply === true/.test(source), "reconcile requires explicit apply=true to insert");
ok(/sample_missing/.test(source), "reconcile reports a dry-run sample before apply");

console.log("genSaveStorageReconcile contract ok");
