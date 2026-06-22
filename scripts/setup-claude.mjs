#!/usr/bin/env node
// Разворачивает командный Claude Code-сетап после клона.
// Линкует скиллы из .agents/skills (трекаются в git) в .claude/skills (их читает Claude Code).
// Идемпотентно, кросс-платформенно (симлинк на mac/linux, копия на Windows). Запусти из корня репо:
//   node scripts/setup-claude.mjs
import { mkdirSync, readdirSync, existsSync, lstatSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = join(root, ".agents", "skills");
const dst = join(root, ".claude", "skills");

if (!existsSync(src)) {
  console.error("✖ не нашёл .agents/skills — запусти скрипт из корня репозитория finance-panel");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });

let linked = 0, copied = 0, skipped = 0;
for (const name of readdirSync(src)) {
  if (!lstatSync(join(src, name)).isDirectory()) continue;
  const link = join(dst, name);
  if (existsSync(link)) { skipped++; continue; }
  try {
    if (process.platform === "win32") { cpSync(join(src, name), link, { recursive: true }); copied++; }
    else { symlinkSync(join("..", "..", ".agents", "skills", name), link); linked++; }
  } catch {
    try { cpSync(join(src, name), link, { recursive: true }); copied++; }
    catch (e) { console.error("  ✖", name, "—", String(e?.message || e)); }
  }
}

console.log(`✓ Скиллы Claude Code готовы: ${linked} симлинков, ${copied} копий, ${skipped} уже было.`);
console.log("");
console.log("Опционально (только если будешь этим пользоваться) — добавь токены в окружение:");
console.log("  • MPSTATS_TOKEN — для скиллов mpstats / photo-editor (аналитика и фото маркетплейсов)");
console.log("  • VIRLO_TOKEN   — для MCP virlo (тренды) из .mcp.json");
console.log("  • gstack (headless-QA, ~1 ГБ) ставится отдельно — спроси владельца, если понадобится.");
console.log("Перезапусти Claude Code, чтобы он подхватил скиллы и .mcp.json.");
