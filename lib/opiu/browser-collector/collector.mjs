import fs from "node:fs";
import path from "node:path";
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
const profileDir = process.env.PROFILE_DIR || path.join(ROOT, "chrome-profile");
const lockFile = path.join(ROOT, "collector.lock");
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(profileDir, { recursive: true });

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

function isoRuDate(value) {
  const match = String(value).match(/(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2})/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function money(value) {
  const match = String(value).match(/(?:^|\s)(\d[\d\s]*(?:[,.]\d{1,2})?)\s*₽/);
  if (!match) return null;
  const amount = Number(match[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

function parsePeriod(text) {
  const explicit = String(text).match(/(?:за\s+период|период)\s*(?:с\s*)?((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.20\d{2})\s*(?:по|[-–—])\s*((?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.20\d{2})/i);
  if (explicit) return { from: isoRuDate(explicit[1]), to: isoRuDate(explicit[2]) };
  const dates = [...String(text).matchAll(/(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.(20\d{2})/g)].map((match) => isoRuDate(match[0])).filter(Boolean);
  return dates.length >= 3 ? { from: dates[1], to: dates[2] }
    : dates.length >= 2 ? { from: dates[0], to: dates[1] }
      : { from: null, to: null };
}

function parseRow(text, target) {
  const normalized = String(text).replace(/\s+/g, " ").trim();
  const awaiting = /ожида(?:ет|ется)\s+(?:перечислен|выплат)|к\s+выплате/i.test(normalized);
  const sent = /отправлен[ао]?|перечислен[ао]?|выплачен[ао]?/i.test(normalized);
  if (!awaiting && !sent) return null;
  const amount = money(normalized);
  const plannedDate = isoRuDate(normalized);
  if (!amount || !plannedDate) return null;
  const period = parsePeriod(normalized);
  const reportMatch = normalized.match(/(?:номер\s+документа(?:\s+оплаты)?|отч[её]т|report|№)\s*[:№]?\s*([A-Za-zА-Яа-я0-9_-]{3,80})/i);
  const reportId = reportMatch?.[1] || null;
  const stablePart = reportId || (period.from && period.to ? `${period.from}:${period.to}` : null);
  if (!stablePart) return null;
  return {
    marketplace: target.marketplace,
    cabinetId: target.cabinetId,
    companyId: target.companyId,
    accountId: target.accountId,
    externalId: `${target.marketplace}:${stablePart}`,
    reportId,
    periodFrom: period.from,
    periodTo: period.to,
    plannedDate,
    amount,
    state: awaiting ? "awaiting_transfer" : "marketplace_sent",
    capturedAt: new Date().toISOString(),
  };
}

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
    const parsed = texts.map((text) => parseRow(text, target)).filter(Boolean);
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
  const playwrightRoot = process.env.PLAYWRIGHT_ROOT || "/Users/maxim/shelf-collector";
  const { chromium } = require(require.resolve("playwright", { paths: [playwrightRoot] }));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    viewport: { width: 1440, height: 900 },
    locale: "ru-RU",
  });
  try {
    if (mode === "login") {
      for (const target of targets) {
        const page = await context.newPage();
        await page.goto(target.homeUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }
      log("login_mode_started");
      await new Promise(() => {});
    }
    for (const target of targets) {
      try {
        await collectTarget(context, target);
      } catch (error) {
        log("target_error", { marketplace: target.marketplace, cabinetId: target.cabinetId, error: error instanceof Error ? error.message : String(error) });
        if (String(error).includes("BLOCKED")) break;
        await randomPause(120_000, 240_000);
      }
    }
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(lockFile, { force: true });
  }
}

main().catch((error) => {
  log("fatal", { error: error instanceof Error ? error.message : String(error) });
  fs.rmSync(lockFile, { force: true });
  process.exitCode = 1;
});
