import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const worker = readFileSync("lib/factory/yandexArchiveWorker.mjs", "utf8");

ok(/archiveFactoryVideosToYandex/.test(worker), "worker reuses shared archive helper");
ok(/NEXT_PUBLIC_SUPABASE_URL/.test(worker), "worker requires Supabase URL");
ok(/SUPABASE_URL/.test(worker), "worker accepts SUPABASE_URL alias");
ok(/SUPABASE_SERVICE_ROLE_KEY/.test(worker), "worker requires service role for analysis updates");
ok(/--env-file/.test(worker), "worker error explains explicit env-file usage");
ok(/loadEnvFiles/.test(worker), "worker auto-loads env files before requiring secrets");
ok(/\?:export\\s\+\)\?/.test(worker), "worker accepts dotenv export prefixes");
ok(/\\s\*=\\s\*/.test(worker), "worker accepts spaces around dotenv equals");
ok(/stripInlineComment/.test(worker), "worker strips unquoted inline dotenv comments");
ok(/FACTORY_YANDEX_REPORT_DIR/.test(worker), "worker writes configurable reports");
ok(/factory-yandex-archive-report\.json/.test(worker), "worker writes JSON report");
ok(/factory-yandex-archive-report\.md/.test(worker), "worker writes markdown report");
ok(/kind: item\.kind/.test(worker), "worker includes asset kind in archive reports");
ok(/Stopping: current batch had failures and no uploads/.test(worker), "worker stops if a batch cannot make progress");
ok(!/delete\(\)/.test(worker), "worker never deletes rows");
ok(!/remove\(/.test(worker), "worker never removes storage files");

console.log("yandexArchiveWorkerContract: passed");
