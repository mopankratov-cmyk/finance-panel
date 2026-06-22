#!/usr/bin/env node
// AI-гейт PR (безопасная версия). Запускается из ai-gate.yml на pull_request_target,
// то есть ДОВЕРЕННЫМ кодом базовой ветки — код самого PR здесь НЕ исполняется.
// Список файлов и дифф приходят как ДАННЫЕ из GitHub API (см. workflow), не из дерева PR.
//
// Логика (безопасно-по-умолчанию):
//   • авто-мёрж разрешён ТОЛЬКО если ВСЕ изменённые файлы из allowlist (доки/текст/картинки),
//     PR не из форка, дифф не огромный, нет deny-флагов И ассистент сказал approve+low;
//   • что угодно иное → escalate (красный чек + пинг владельцу, вливает он сам);
//   • любая ошибка/недоступность → escalate (fail-safe).
//
// ENV: GITHUB_EVENT_PATH, PR_DIFF_FILE, PR_FILES_FILE, DIRECTOR_COCKPIT_URL,
//      REVIEW_TOKEN (или CRON_SECRET), TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT_ID, GITHUB_OUTPUT

import { readFileSync, appendFileSync } from "node:fs";

const log = (...a) => console.log("[pr-gate]", ...a);
const DIFF_LIMIT = 60000;

// Auto-merge допустим только для этих расширений (всё остальное — к владельцу).
// ВНИМАНИЕ: .svg сюда НЕ входит — это активный контент (может содержать <script>, исполняется
// в origin при открытии) → потенциальный stored-XSS. SVG всегда уходит на ручную проверку.
const SAFE_FILE = /\.(md|mdx|txt|png|jpe?g|gif|webp|ico)$/i;

// Deny-классы — для понятного «почему эскалировали» и доп. страховки.
const RISK_RULES = [
  [/(^|\/)\.env/i, ".env / секреты"],
  [/(^|\/)migrations?\//i, "миграции БД"],
  [/\.sql$/i, "SQL / схема БД"],
  [/\.prisma$/i, "Prisma-схема"],
  [/(^|\/)(prisma|drizzle|db)\//i, "схема/слой БД"],
  [/(^|\/)package\.json$/i, "зависимости (package.json)"],
  [/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i, "lock-файл зависимостей"],
  [/(^|\/)\.npmrc$/i, ".npmrc (реестр/install-хуки)"],
  [/(^|\/)\.github\//i, "CI/CD (.github)"],
  [/(^|\/)pr-gate\.mjs$/i, "сам гейт (pr-gate.mjs)"],
  [/\.(mjs|cjs|sh|bash|ps1)$/i, "исполняемый скрипт"],
  [/(^|\/)(Dockerfile|\.dockerignore|docker-compose\.ya?ml|fly\.toml|render\.yaml|netlify\.toml|Procfile|\.vercelignore|now\.json|app\.json)$/i, "деплой/инфра-конфиг"],
  [/(^|\/)vercel\.json$/i, "vercel.json"],
  [/(^|\/)next\.config\.[a-z]+$/i, "next.config"],
  [/(^|\/)(middleware|proxy)\.(ts|js|tsx|jsx|mjs|cjs)$/i, "middleware / proxy"],
  [/(auth|authz|session|permission|oauth|token|password|secret|credential|payment|billing|stripe|webhook|checkout|invoice|payout)/i, "авторизация / оплата / вебхуки"],
];

function readEvent() {
  try { return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")); }
  catch (e) { log("нет GITHUB_EVENT_PATH:", String(e?.message || e)); return null; }
}
function readFile(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

// Парсит `status<TAB>path` из GitHub API (--jq @tsv). Статусы: added/modified/removed/renamed/copied/changed.
function parseFiles(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    out.push({ status: line.slice(0, tab).toLowerCase(), path: line.slice(tab + 1) });
  }
  return out;
}

function denyFlags(files) {
  const flags = new Set();
  for (const f of files) {
    if (f.status.startsWith("remov") || f.status.startsWith("delet")) flags.add("удаление файлов");
    if (f.status.startsWith("renam")) flags.add("переименование/перемещение");
    for (const [re, label] of RISK_RULES) if (re.test(f.path)) flags.add(label);
  }
  return [...flags];
}

// allowlist: каждый файл — безопасного типа и только добавлен/изменён (без удалений/переименований).
function allFilesSafe(files) {
  if (!files.length) return false;
  return files.every((f) => SAFE_FILE.test(f.path) && /^(add|modif|chang)/.test(f.status));
}

async function askCockpit(pr, diff) {
  const base = (process.env.DIRECTOR_COCKPIT_URL || "https://director-cockpit.vercel.app").replace(/\/$/, "");
  const secret = process.env.REVIEW_TOKEN || process.env.CRON_SECRET;
  if (!secret) return { decision: "escalate", risk: "high", reasons: ["ревьюер не настроен (нет REVIEW_TOKEN)"], summary: "" };
  try {
    const r = await fetch(`${base}/api/review`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(55000),
      body: JSON.stringify({
        title: pr.title || "", body: pr.body || "",
        diff: diff.slice(0, DIFF_LIMIT), fullDiffLength: diff.length,
        repo: pr.base?.repo?.full_name || "", author: pr.user?.login || "",
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return { decision: "escalate", risk: "high", reasons: [`ревьюер ответил ошибкой (${r.status})`], summary: "" };
    return {
      decision: j.decision === "approve" ? "approve" : "escalate",
      risk: j.risk === "low" ? "low" : "high",
      reasons: Array.isArray(j.reasons) ? j.reasons.map(String) : [],
      summary: String(j.summary || ""),
    };
  } catch (e) {
    return { decision: "escalate", risk: "high", reasons: [`ревьюер недоступен: ${String(e?.message || e).slice(0, 120)}`], summary: "" };
  }
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHANNEL || "";
  if (!token || !chat) { log("Telegram не настроен — печатаю:\n" + text); return; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) log("Telegram отказал:", j.description || r.status);
  } catch (e) { log("Telegram упал:", String(e?.message || e)); }
}

function setOutput(decision, reason) {
  log(`decision=${decision} :: ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    try { appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decision}\nreason=${reason.replace(/\n/g, " ").slice(0, 200)}\n`); }
    catch (e) { log("не записал GITHUB_OUTPUT:", String(e?.message || e)); }
  }
}

async function main() {
  const ev = readEvent();
  const pr = ev?.pull_request;
  if (!pr) { setOutput("escalate", "нет pull_request в событии"); return; }

  const diff = readFile(process.env.PR_DIFF_FILE);
  const files = parseFiles(readFile(process.env.PR_FILES_FILE));
  const cockpit = await askCockpit(pr, diff);

  const flags = denyFlags(files);
  const tooBig = diff.length > DIFF_LIMIT;
  // fail-safe: форком считаем всё, что НЕ доказанно из этого же репозитория (нет метаданных → как форк).
  const sameRepo = !!(pr.head?.repo?.full_name && pr.base?.repo?.full_name && pr.head.repo.full_name === pr.base.repo.full_name);
  const isFork = !sameRepo;
  // авто-мёрж только в защищённый main. Иначе (PR в throwaway-базу) дифф считается против неё —
  // классический обход: «доки против левой базы» → потом смена базы на main. Не одобряем.
  const baseNotMain = (pr.base?.ref || "") !== "main";
  // крупный PR → к человеку (текст по строкам + страховка от бинарного bloat, который в diff виден одной строкой).
  const changeCount = files.length || Number(pr.changed_files || 0);
  const lineCount = Number(pr.additions || 0) + Number(pr.deletions || 0);
  const tooMany = changeCount > 25 || lineCount > 1500;
  const safe = allFilesSafe(files);

  const approved = safe && !flags.length && !tooBig && !isFork && !baseNotMain && !tooMany
    && cockpit.decision === "approve" && cockpit.risk === "low";

  const author = pr.user?.login || "сотрудник";
  const head = pr.head?.ref || "?";
  const base = pr.base?.ref || "main";
  const stat = `${files.length || pr.changed_files || "?"} файлов, +${pr.additions ?? "?"} / −${pr.deletions ?? "?"}`;
  const reasons = cockpit.reasons.length ? cockpit.reasons.map((x) => `• ${x}`).join("\n") : "";

  if (approved) {
    await sendTelegram([
      `✅ AI-гейт ОДОБРИЛ и вливает PR #${pr.number}`, "",
      `📌 ${pr.title || "(без заголовка)"}  — ${author}`,
      `🌿 ${head} → ${base}  ·  ${stat}`,
      cockpit.summary ? `📝 ${cockpit.summary}` : "", reasons, "",
      `🔗 ${pr.html_url || ""}`,
    ].filter(Boolean).join("\n"));
    setOutput("approve", "доки/текст + ассистент одобрил");
    return;
  }

  const why = [
    isFork ? "PR не из этого репозитория" : "",
    baseNotMain ? `база не main (${pr.base?.ref || "?"})` : "",
    tooBig || tooMany ? "крупный PR" : "",
    !safe && !flags.length ? "затронут код/конфиг (не доки)" : "",
    flags.length ? `риск: ${flags.join(", ")}` : "",
    cockpit.decision !== "approve" ? "ассистент не одобрил" : (cockpit.risk !== "low" ? "ассистент: риск высокий" : ""),
  ].filter(Boolean).join("; ");
  await sendTelegram([
    `⚠️ AI-гейт: нужна ТВОЯ проверка PR #${pr.number}`, "",
    `📌 ${pr.title || "(без заголовка)"}  — ${author}`,
    `🌿 ${head} → ${base}  ·  ${stat}`,
    `❗ Причина: ${why}`,
    cockpit.summary ? `📝 ${cockpit.summary}` : "", reasons, "",
    `🔗 Проверь и влей сам: ${pr.html_url || ""}`,
  ].filter(Boolean).join("\n"));
  setOutput("escalate", why || "эскалация");
}

main().catch((e) => {
  log("фатальная ошибка → escalate:", String(e?.message || e));
  setOutput("escalate", "сбой гейта");
  process.exit(0);
});
