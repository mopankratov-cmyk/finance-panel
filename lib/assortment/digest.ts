/**
 * Недельная сводка модуля в Telegram — по воскресеньям (решение владельца
 * 01.10.2026: «раз в неделю в вс»). Чистые функции.
 *
 * Только наблюдённое: новые находки, отметки ритейлеров, решения людей,
 * состояние подборок. Пустая неделя называется пустой, а не пропускается
 * молча. Цен нет (граница ТЗ).
 */

import { plural } from "@/lib/warehouse/plural";
import { dm } from "./appearance";
import type { DigestChanges, DigestChangesBlock } from "./appearanceStore";
import type { ChinaDigest } from "./chinaStore";
import type { AssortmentDirection } from "./constants";
import { DIRECTION_LABEL } from "./constants";
import { partsCaveat, type HistoryStatus } from "./observationState";
import { BRAND_LABEL, compactRu, refArticle, VERDICT_LABEL, type SocialDigest } from "./socialFeed";

export interface DigestFinding {
  id: string;
  title: string;
  brand: string | null;
  label: string;
  tone: "retail" | "novelty" | "single" | "manual";
}

export interface DigestDirection {
  newCount: number;
  retailCount: number;
  top: DigestFinding[];
  selected: number;
  sampleNeeded: number;
  rejected: number;
  topReason: string | null;
}

export interface DigestFacts {
  from: string;
  to: string;
  directions: Record<AssortmentDirection, DigestDirection>;
  collections: Array<{ id: string; title: string; progress: string; status: string; version: number }>;
  /** Пульс автообхода; null — обход ещё не запускался или миграции нет. */
  crawl: { ok: string[]; failing: Array<{ name: string; error: string }> } | null;
  /** Глубина истории наблюдений по источникам каталогов; null — журнала прогонов нет. Без слов «растёт/падает»: динамика — не раньше четырёх недель. */
  history?: Array<{ name: string; status: HistoryStatus; parts?: string[] }> | null;
  /** «Залетает в соцсетях»: новые «залёты» недели (до пяти); null или нет — раздела нет (таблиц нет или ничего не залетело). */
  social?: SocialDigest | null;
  /** «Появилось / пропало» по полным прогонам: за неделю, в первое воскресенье месяца — и за месяц; null или нет — ни один источник не готов. */
  changes?: DigestChanges | null;
  /** «Китай (1688)»: новое в топе ниш и рост копий по номерам из рилсов за неделю; null или нет — раздела нет (нет ключа, таблиц, данных). */
  china?: ChinaDigest | null;
  baseUrl: string;
}

const TONE_RANK: Record<DigestFinding["tone"], number> = { retail: 3, novelty: 2, manual: 1, single: 1 };

/** Три самые сильные находки недели: сначала отметки ритейлеров. */
export function topFindings(findings: DigestFinding[], limit = 3): DigestFinding[] {
  return [...findings].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone]).slice(0, limit);
}

export function telegramEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const day = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", timeZone: "Europe/Moscow" });

function findingsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "новая находка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "новые находки";
  return "новых находок";
}

const HISTORY_GROUPS: Array<{ statuses: HistoryStatus[]; text: string }> = [
  { statuses: ["dynamics"], text: "Можно смотреть динамику" },
  { statuses: ["appearance"], text: "«Появилось» и «пропало» — наблюдение" },
  { statuses: ["building", "none"], text: "История копится (нужны два полных прогона с разрывом от 7 дней)" },
  { statuses: ["window_only"], text: "Только верх выдачи (пропажу не определить)" },
];
const MAX_NAMES = 8;

/** Что уже можно утверждать по накопленной истории — чтобы «нового нет» не читалось как «ничего не изменилось». */
function historyLines(history: DigestFacts["history"]): string[] {
  if (!history || history.length === 0) return [];
  const lines: string[] = [];
  for (const group of HISTORY_GROUPS) {
    const names = history.filter((h) => group.statuses.includes(h.status)).map((h) => h.name);
    if (names.length === 0) continue;
    const shown = names.slice(0, MAX_NAMES).map(telegramEscape).join(", ");
    lines.push(`${group.text}: ${shown}${names.length > MAX_NAMES ? ` и ещё ${names.length - MAX_NAMES}` : ""}.`);
  }
  // Части разделов (Zara CHAQUETA, коллаборации Uniqlo) — окна: «наблюдение» по источнику на их модели не распространяется.
  const caveat = partsCaveat(history);
  if (caveat) lines.push(telegramEscape(caveat));
  return lines.length > 0 ? ["", "<b>История каталогов</b>", ...lines] : [];
}

/** Раздел «Залетает в соцсетях»: до пяти новых «залётов» недели — бренд, название, просмотры и лайки, ссылка на рилс; лента — в панели. */
function socialLines(social: DigestFacts["social"], base: string): string[] {
  if (social?.error) return ["", "<b>Залетает в соцсетях</b>", `⚠️ Не загрузилось: ${telegramEscape(social.error)}`];
  if (!social || social.items.length === 0) return [];
  const lines = ["", "<b>Залетает в соцсетях</b>", `Новых за неделю: ${social.total} (рилсы Instagram про Zara и Uniqlo; лайки и просмотры — не продажи).`];
  for (const item of social.items) {
    const numbers = [item.views != null ? `${compactRu(item.views)} просмотров` : null, item.likes != null ? `${compactRu(item.likes)} лайков` : null].filter(Boolean).join(", ");
    const name = telegramEscape(`${BRAND_LABEL[item.brand]} · ${item.title}`);
    lines.push(`• ${name} (${DIRECTION_LABEL[item.direction].toLowerCase()}) — ${numbers ? `${telegramEscape(numbers)}, ` : ""}${VERDICT_LABEL[item.verdict].toLowerCase()} — <a href="${telegramEscape(item.url)}">рилс</a>`);
  }
  const directions = [...new Set(social.items.map((i) => i.direction))];
  lines.push(`Лента: ${directions.map((d) => `<a href="${base}/assortment-development/${d}?view=social">${DIRECTION_LABEL[d]}</a>`).join(" · ")}`);
  return lines;
}

const dmShort = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Раздел «Китай (1688)»: до пяти «новых в топе» ниш (снимок недели против прошлого снимка ниши — расчёт) и рост копий по номерам из
 * рилсов (оценка снизу: поиск 1688 находит часть карточек). Только при данных; не загрузилось — строка, а не молчание. Цен нет.
 */
function chinaLines(china: DigestFacts["china"], base: string): string[] {
  if (china?.error) return ["", "<b>Китай (1688)</b>", `⚠️ Не загрузилось: ${telegramEscape(china.error)}`];
  if (!china || (china.items.length === 0 && china.growth.length === 0)) return [];
  const lines = ["", "<b>Китай (1688): топ ниш и копии</b>", `Снимок недели с ${dmShort(china.week)}. Оптовые продажи в Китае — не спрос WB; цены не показываем.`];
  if (china.items.length > 0) {
    lines.push(`Новое в топе: ${china.newTotal} в ${china.niches} ${plural(china.niches, "нише", "нишах", "нишах")} (к прошлому снимку ниши — расчёт).`);
    for (const item of china.items) {
      lines.push(`• ${telegramEscape(item.niche)}: <a href="${telegramEscape(item.url)}">${telegramEscape(item.title.slice(0, 80))}</a> — №${item.rank} в выдаче`);
    }
    if (china.newTotal > china.items.length) lines.push(`• и ещё ${china.newTotal - china.items.length}`);
  }
  if (china.growth.length > 0) {
    lines.push("Копий на 1688 стало больше (номера из рилсов; оценка снизу, прирост — расчёт):");
    for (const g of china.growth) lines.push(`• ${BRAND_LABEL[g.brand]} ${refArticle(g.refKey) ?? g.number} — ${g.offers} ${plural(g.offers, "копия", "копии", "копий")} (+${g.delta} за неделю)`);
  }
  lines.push(`Смотреть: ${(["bags", "jackets"] as const).map((d) => `<a href="${base}/assortment-development/${d}?view=china">${DIRECTION_LABEL[d]}</a>`).join(" · ")}`);
  return lines;
}

const MAX_CHANGE_SOURCES = 6;
/** В месячной выжимке — только итог раздела и где изменений больше всего: подробности недели в ней уже есть, а сообщение не резиновое. */
const MAX_MONTH_LEADERS = 3;

const daysWord = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

/**
 * Строки одного периода раздела «Появилось / пропало»: по разделам — итог, а в подробном виде (неделя) ещё источники с датами
 * прогонов и примеры появившегося. Месячная выжимка — compact: итог и до трёх источников, где изменений больше всего.
 */
function changesBlockLines(block: DigestChangesBlock, compact = false): string[] {
  const lines: string[] = [];
  for (const direction of ["bags", "jackets"] as const) {
    const d = block.directions[direction];
    if (!d) {
      lines.push(`${DIRECTION_LABEL[direction]}: сравнивать пока не по чему — история полных прогонов копится или за период не было полного прогона.`);
      continue;
    }
    const appeared = d.sources.reduce((n, s) => n + s.appeared, 0);
    const disappeared = d.sources.reduce((n, s) => n + s.disappeared, 0);
    const first = d.sources.reduce((n, s) => n + s.firstInWindow, 0);
    if (appeared + disappeared + first === 0) {
      lines.push(`${DIRECTION_LABEL[direction]}: ничего не появилось и не пропало${compact ? "" : ` (${telegramEscape(d.quiet.join(", "))})`}.`);
      continue;
    }
    const totals = [`появилось ${appeared}`, `пропало ${disappeared}`, first > 0 ? `впервые в верху выдачи ${first}` : null].filter(Boolean).join(", ");
    if (compact) {
      const leaders = d.sources.slice(0, MAX_MONTH_LEADERS).map((s) => s.name);
      lines.push(`${DIRECTION_LABEL[direction]}: ${totals}${leaders.length ? ` — больше всего у ${telegramEscape(leaders.join(", "))}` : ""}.`);
      continue;
    }
    lines.push(`${DIRECTION_LABEL[direction]}: ${totals}.`);
    for (const s of d.sources.slice(0, MAX_CHANGE_SOURCES)) {
      const parts = [s.appeared ? `+${s.appeared}` : null, s.disappeared ? `−${s.disappeared}` : null, s.firstInWindow ? `впервые в верху выдачи ${s.firstInWindow}` : null].filter(Boolean).join(" / ");
      // База устарела (сборщик простаивал) — сравнение не за неделю, а за весь простой: так и написано.
      const span = s.staleSpanDays != null ? `, за ${daysWord(s.staleSpanDays)} — сборщик простаивал` : "";
      const runs = s.fromOn && s.toOn ? ` (прогоны ${dm(s.fromOn)} → ${dm(s.toOn)}${span})` : "";
      lines.push(`• ${telegramEscape(s.name)}: ${parts}${runs}${s.mass ? " — массовая смена, похоже на смену обхода" : ""}`);
    }
    if (d.sources.length > MAX_CHANGE_SOURCES) lines.push(`• и ещё ${d.sources.length - MAX_CHANGE_SOURCES}`);
    if (d.examples.length > 0) lines.push(`Новое: ${telegramEscape(d.examples.join("; "))}.`);
  }
  return lines;
}

/**
 * Раздел «Появилось / пропало» (по полным прогонам): за неделю; в первое воскресенье месяца — ещё и выжимка за месяц. Даты прогонов
 * — у каждого источника. Не посчитался — строка «не загрузилось», а не молчание.
 */
function changesLines(changes: DigestFacts["changes"], base: string): string[] {
  if (!changes) return [];
  if (changes.error || !changes.week) return ["", "<b>Появилось / пропало</b>", `⚠️ Не загрузилось: ${telegramEscape(changes.error ?? "нет данных")}`];
  const lines = ["", "<b>Появилось / пропало за неделю</b>", `По полным прогонам обхода. «Пропало» — модели нет в ${changes.disappearRuns} полных прогонах подряд, а до них была.`];
  if (changes.season) lines.push(telegramEscape(changes.season));
  lines.push(...changesBlockLines(changes.week));
  lines.push(`Смотреть: ${(["bags", "jackets"] as const).map((d) => `<a href="${base}/assortment-development/${d}?view=changes">${DIRECTION_LABEL[d]}</a>`).join(" · ")}`);
  if (changes.month) {
    lines.push("", `<b>За месяц: ${dm(changes.month.periodStart)}–${dm(changes.month.today)}</b>`, ...changesBlockLines(changes.month, true));
  }
  return lines;
}

export function digestMessage(facts: DigestFacts): string {
  const base = facts.baseUrl.replace(/\/+$/, "");
  const lines = [`🧵 <b>Разработка ассортимента — неделя ${day(facts.from)}–${day(facts.to)}</b>`];
  let anything = false;
  for (const direction of ["bags", "jackets"] as const) {
    const d = facts.directions[direction];
    lines.push("", `<b>${DIRECTION_LABEL[direction]}</b>`);
    if (d.newCount === 0) {
      lines.push("Новых находок нет.");
    } else {
      anything = true;
      lines.push(`${d.newCount} ${findingsWord(d.newCount)}${d.retailCount > 0 ? `, из них отмечено ритейлером: ${d.retailCount}` : ""}.`);
      for (const f of d.top) {
        const name = telegramEscape([f.brand, f.title].filter(Boolean).join(" · "));
        lines.push(`• <a href="${base}/assortment-development/${direction}/${f.id}">${name}</a> — ${telegramEscape(f.label)}`);
      }
    }
    const decisions = [
      d.selected > 0 ? `отобрано ${d.selected}` : null,
      d.sampleNeeded > 0 ? `нужен образец ${d.sampleNeeded}` : null,
      d.rejected > 0 ? `отклонено ${d.rejected}${d.topReason ? ` (чаще всего: ${telegramEscape(d.topReason.toLowerCase())})` : ""}` : null,
    ].filter(Boolean);
    if (decisions.length > 0) {
      anything = true;
      lines.push(`Решения: ${decisions.join(", ")}.`);
    }
  }
  if (facts.collections.length > 0) {
    anything = true;
    lines.push("", "<b>Подборки</b>");
    for (const c of facts.collections) {
      lines.push(`• <a href="${base}/assortment-development/collections/${c.id}">${telegramEscape(c.title)}</a> — ${telegramEscape(c.progress)}, ${telegramEscape(c.status)}${c.status === "сохранена" ? ` v${c.version}` : ""}`);
    }
  }
  lines.push(...changesLines(facts.changes, base));
  if (facts.changes?.week && Object.values(facts.changes.week.directions).some((d) => d && d.sources.length > 0)) anything = true;
  lines.push(...socialLines(facts.social, base));
  if (facts.social?.items.length) anything = true;
  lines.push(...chinaLines(facts.china, base));
  if (facts.china && (facts.china.items.length > 0 || facts.china.growth.length > 0)) anything = true;
  if (facts.crawl && (facts.crawl.ok.length > 0 || facts.crawl.failing.length > 0)) {
    lines.push("", "<b>Автообход каталогов</b>");
    if (facts.crawl.ok.length > 0) lines.push(`Работает: ${telegramEscape(facts.crawl.ok.join(", "))}.`);
    for (const f of facts.crawl.failing) lines.push(`⚠️ ${telegramEscape(f.name)}: ${telegramEscape(f.error)}`);
  }
  lines.push(...historyLines(facts.history));
  if (!anything) {
    lines.push("", facts.crawl?.ok.length
      ? "За неделю новых моделей не появилось ни в каталогах, ни среди ручных находок."
      : "За неделю в модуле ничего не происходило. Автообход каталогов пока не подключён — находки добавляются вручную.");
  }
  lines.push("", `<a href="${base}/assortment-development">Открыть модуль</a>`);
  return lines.join("\n");
}

/** Предел Telegram на одно сообщение — символов текста после разбора разметки (теги и сущности не в счёт). */
export const TELEGRAM_TEXT_LIMIT = 4096;

/** Сколько символов Telegram насчитает в тексте с HTML-разметкой: теги не в счёт, сущность — один символ. */
export function telegramVisibleLength(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp|quot|#\d+);/g, "_").length;
}

/**
 * Текст → сообщения не длиннее предела Telegram. Режем по границам разделов (пустая строка), а раздел длиннее предела — по
 * строкам: каждая строка сводки — законченная разметка (тег открыт и закрыт в ней же), поэтому разрез между строками разметку не
 * ломает. Строка длиннее предела (не бывает, но) — обрезается видимым текстом с многоточием.
 */
export function splitTelegramMessage(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  const sections: string[][] = [[]];
  for (const line of text.split("\n")) {
    if (line === "" && sections[sections.length - 1].length > 0) sections.push([]);
    else if (line !== "") sections[sections.length - 1].push(line);
  }
  const fit = (line: string) => {
    if (telegramVisibleLength(line) <= limit) return line;
    const plain = line.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
    return `${telegramEscape(plain.slice(0, limit - 1))}…`;
  };
  const messages: string[] = [];
  let current = "";
  const push = (piece: string, separator: string) => {
    const joined = current ? `${current}${separator}${piece}` : piece;
    if (telegramVisibleLength(joined) <= limit) {
      current = joined;
      return true;
    }
    return false;
  };
  for (const section of sections.filter((s) => s.length > 0)) {
    if (push(section.join("\n"), "\n\n")) continue;
    if (current) messages.push(current);
    current = "";
    if (push(section.join("\n"), "\n\n")) continue;
    // Раздел сам длиннее предела — по строкам.
    for (const line of section.map(fit)) {
      if (push(line, "\n")) continue;
      messages.push(current);
      current = line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

/** Сводка — одним сообщением, а если не влезает в предел Telegram (первое воскресенье месяца, много источников и сбоев), — несколькими. */
export function digestMessages(facts: DigestFacts): string[] {
  return splitTelegramMessage(digestMessage(facts));
}
