import fs from "node:fs";
import path from "node:path";
import { parsePayoutRowDetailed } from "./parsePayoutRow.mjs";
import { groupTargetsByProfile } from "./profiles.mjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv.includes("--login") ? "login" : "collect";

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadEnv(path.join(ROOT, ".env"));
const logDir = process.env.LOG_DIR || path.join(ROOT, "logs");
// Корень профилей: внутри — папка на профиль. Один общий профиль не годится,
// WB держит одну сессию продавца на профиль (см. profiles.mjs).
const profilesRoot = process.env.PROFILE_DIR || path.join(ROOT, "chrome-profiles");
const lockFile = path.join(ROOT, "collector.lock");
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(profilesRoot, { recursive: true });

function rotateLog() {
  const file = path.join(logDir, "collector.log");
  if (!fs.existsSync(file) || fs.statSync(file).size < 5_000_000) return file;
  for (let index = 4; index >= 1; index--) {
    const from = `${file}.${index}`;
    const to = `${file}.${index + 1}`;
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  fs.renameSync(file, `${file}.1`);
  return file;
}

function log(message, details) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  fs.appendFileSync(rotateLog(), `${new Date().toISOString()} ${message}${suffix}\n`);
}

function acquireLock() {
  try {
    const fd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    try {
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (age > 60 * 60 * 1000) { fs.unlinkSync(lockFile); return acquireLock(); }
    } catch {}
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomPause = (min = 1600, max = 4200) => sleep(Math.round(min + Math.random() * (max - min)));





async function postSnapshot(snapshot) {
  const endpoint = process.env.FINANCE_PANEL_URL;
  const secret = process.env.FINANCE_MONITOR_SECRET;
  if (!endpoint || !secret) throw new Error("FINANCE_PANEL_URL или FINANCE_MONITOR_SECRET не настроены");
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/api/opiu/browser-payout-snapshots`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `Финансовая панель ответила ${response.status}`);
}

async function collectTarget(context, target) {
  const page = await context.newPage();
  try {
    await page.goto(target.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await randomPause();
    await page.goto(target.payoutUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await randomPause(2500, 6000);
    const bodyText = await page.locator("body").innerText({ timeout: 20_000 });
    if (/captcha|подтвердите, что вы не робот|доступ временно ограничен|слишком много запросов/i.test(bodyText)) {
      throw new Error("BLOCKED: маркетплейс показал защиту — повторы остановлены до следующего запуска");
    }
    if (/войти|авторизац|login/i.test(bodyText.slice(0, 1200)) && !/выплат|финанс/i.test(bodyText)) {
      throw new Error("LOGIN_REQUIRED: профиль нужно открыть через --login и авторизовать по VNC");
    }
    const selectors = target.rowSelectors?.length ? target.rowSelectors : ["tr", "[role=row]", "[data-widget*='payment']", "[class*='payment']"];
    const texts = [];
    for (const selector of selectors) {
      for (const text of await page.locator(selector).allInnerTexts().catch(() => [])) if (text.trim()) texts.push(text);
    }
    const parsed = [];
    // Пропуски не должны быть немыми: при установке по ним видно, что подпись
    // колонки на живой странице другая, и какой якорь нужно дописать.
    const skipReasons = new Map();
    const skipSamples = [];
    for (const text of texts) {
      const result = parsePayoutRowDetailed(text, target);
      if ("row" in result) { parsed.push(result.row); continue; }
      skipReasons.set(result.skipped, (skipReasons.get(result.skipped) ?? 0) + 1);
      // Причина «нет признака статуса» — это обычные строки вёрстки (шапки,
      // меню). Их примеры только зашумили бы лог.
      if (result.skipped !== "нет признака статуса выплаты" && skipSamples.length < 3) {
        skipSamples.push(text.replace(/\s+/g, " ").trim().slice(0, 200));
      }
    }
    if (skipReasons.size) {
      log("row_skipped", {
        marketplace: target.marketplace,
        cabinetId: target.cabinetId,
        reasons: Object.fromEntries(skipReasons),
        samples: skipSamples,
      });
    }
    const unique = new Map(parsed.map((row) => [row.externalId, row]));
    if (!unique.size) {
      await page.screenshot({ path: path.join(logDir, `${target.marketplace}-${target.cabinetId}-${Date.now()}.png`), fullPage: true });
      throw new Error("На странице не найдено ни одной выплаты с устойчивым ID/периодом, датой, суммой и статусом");
    }
    for (const snapshot of unique.values()) await postSnapshot(snapshot);
    log("target_success", { marketplace: target.marketplace, cabinetId: target.cabinetId, rows: unique.size });
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!acquireLock()) { log("skip_locked"); return; }
  const configPath = process.env.TARGETS_FILE || path.join(ROOT, "targets.json");
  const targets = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const require = createRequire(import.meta.url);
  // Playwright берём из СВОЕЙ папки. Раньше сборщик тянул его из соседнего
  // shelf-collector: обновление или переезд «Полок» молча ронял сбор выплат.
  // PLAYWRIGHT_ROOT остаётся явным опт-ином, если ставить пакет отдельно.
  const playwrightRoots = process.env.PLAYWRIGHT_ROOT ? [process.env.PLAYWRIGHT_ROOT, ROOT] : [ROOT];
  let chromium;
  try {
    ({ chromium } = require(require.resolve("playwright", { paths: playwrightRoots })));
  } catch {
    throw new Error(`Playwright не найден. Установите его в саму папку сборщика: cd ${ROOT} && npm install`);
  }
  const groups = groupTargetsByProfile(targets);
  if (!groups.length) throw new Error(`В ${configPath} нет ни одной цели с marketplace и cabinetId`);
  const openProfile = (profile) => chromium.launchPersistentContext(path.join(profilesRoot, profile), {
    headless: false,
    executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
  });
  try {
    if (mode === "login") {
      // По профилю за раз: в одном окне видно ровно те кабинеты, что делят
      // сессию. Переход к следующему — по Enter, чтобы человек успел войти.
      for (const [index, group] of groups.entries()) {
        const context = await openProfile(group.profile);
        try {
          for (const target of group.targets) {
            const page = await context.newPage();
            await page.goto(target.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
          }
          log("login_profile_opened", { profile: group.profile, targets: group.targets.map((item) => `${item.marketplace}:${item.cabinetId}`) });
          const remaining = groups.length - index - 1;
          process.stdout.write(`\nПрофиль ${group.profile} (${group.targets.length} кабинет(ов)). Войдите в открытых вкладках.\n`);
          process.stdout.write(remaining ? `Готово — нажмите Enter, останется профилей: ${remaining}\n` : "Готово — нажмите Enter, это последний профиль\n");
          await waitForEnter();
        } finally {
          await context.close().catch(() => {});
        }
      }
      log("login_mode_finished", { profiles: groups.length });
      return;
    }
    for (const group of groups) {
      const context = await openProfile(group.profile);
      let blocked = false;
      try {
        for (const target of group.targets) {
          try {
            await collectTarget(context, target);
          } catch (error) {
            log("target_error", { profile: group.profile, marketplace: target.marketplace, cabinetId: target.cabinetId, error: error instanceof Error ? error.message : String(error) });
            // Блокировка — про этот кабинет и его сессию. Остальные профили
            // это не касается, поэтому обход продолжается с новым окном.
            if (String(error).includes("BLOCKED")) { blocked = true; break; }
            await randomPause(120_000, 240_000);
          }
        }
      } finally {
        await context.close().catch(() => {});
      }
      if (blocked) log("profile_skipped_after_block", { profile: group.profile });
    }
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
  });
}

main().catch((error) => {
  log("fatal", { error: error instanceof Error ? error.message : String(error) });
  fs.rmSync(lockFile, { force: true });
  process.exitCode = 1;
});
