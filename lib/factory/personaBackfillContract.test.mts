import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/personas/backfill/route.ts", "utf8");
const ugcJobs = readFileSync("lib/factory/ugcJobs.ts", "utf8");
const ugcScript = readFileSync("lib/factory/ugcScript.ts", "utf8");

ok(/creatifyListAvatars/.test(route), "persona backfill reads Creatify stock avatars");
ok(/factory_personas/.test(route), "persona backfill writes factory_personas");
ok(/consent_status: "stock"/.test(route), "backfilled Creatify personas are marked as stock consent");
ok(/consent_source: "platform_stock"/.test(route), "backfilled personas keep consent source");
ok(/onConflict: "provider,provider_persona_id"/.test(route), "persona backfill is idempotent");
ok(/dry_run/.test(route), "persona backfill supports dry-run");
ok(/RENDER_CONSENT_STATUSES/.test(ugcJobs) && /"stock"/.test(ugcJobs), "UGC render consent accepts stock personas");
ok(/RENDER_CONSENT_STATUSES/.test(ugcScript) && /"stock"/.test(ugcScript), "UGC script render gate accepts stock personas");

console.log("personaBackfillContract: passed");
