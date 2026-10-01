/**
 * Недельная сводка модуля в Telegram — по воскресеньям (решение владельца
 * 01.10.2026: «раз в неделю в вс»). Чистые функции.
 *
 * Только наблюдённое: новые находки, отметки ритейлеров, решения людей,
 * состояние подборок. Пустая неделя называется пустой, а не пропускается
 * молча. Цен нет (граница ТЗ).
 */

import type { AssortmentDirection } from "./constants";
import { DIRECTION_LABEL } from "./constants";

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
  if (facts.crawl && (facts.crawl.ok.length > 0 || facts.crawl.failing.length > 0)) {
    lines.push("", "<b>Автообход каталогов</b>");
    if (facts.crawl.ok.length > 0) lines.push(`Работает: ${telegramEscape(facts.crawl.ok.join(", "))}.`);
    for (const f of facts.crawl.failing) lines.push(`⚠️ ${telegramEscape(f.name)}: ${telegramEscape(f.error)}`);
  }
  if (!anything) {
    lines.push("", facts.crawl?.ok.length
      ? "За неделю новых моделей не появилось ни в каталогах, ни среди ручных находок."
      : "За неделю в модуле ничего не происходило. Автообход каталогов пока не подключён — находки добавляются вручную.");
  }
  lines.push("", `<a href="${base}/assortment-development">Открыть модуль</a>`);
  return lines.join("\n");
}
