/**
 * Локальный запуск синхронизации WB → Supabase (без Next.js dev server).
 * Usage: node --env-file=.env.local --import tsx scripts/wb-sync.ts [7d|full]
 */
import { chunkRange } from "../lib/wb/keys";
import { runWbSync } from "../lib/wb/sync";

const mode = process.argv[2] ?? "7d";

async function main() {
  const result =
    mode === "full"
      ? await runWbSync({ full: true })
      : await runWbSync(chunkRange(0));

  console.log(JSON.stringify(result, null, 2));
  const failed = Object.entries(result.results).filter(([, v]) => v !== "ok");
  if (failed.length > 0) {
    console.error("Failed:", failed);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
