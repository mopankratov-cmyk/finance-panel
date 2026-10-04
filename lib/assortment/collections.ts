/**
 * Подборки и задание на образец (ТЗ §8). Чистые функции.
 *
 * План сумок — пять разных конструктивных идей и до трёх резервных; пять
 * расцветок одной модели — это одна идея. Если убедительных кандидатов меньше,
 * честно показываем «3 из 5». Доска курток — без обязательного количества,
 * с группировкой по подтипу и силуэту. Это план изучения и разработки
 * образцов для своей фабрики, а не заказ партии; цен здесь нет.
 */

import { containsMoney } from "./attributes";
import type { AssortmentDirection } from "./constants";

export type CollectionKind = "bags_month" | "jackets_season" | "custom";
export type CollectionStatus = "draft" | "saved" | "archived";
export type ReplaceReason = "repeats_assortment" | "shape" | "audience" | "weak_evidence";

export const BAGS_MAIN_SLOTS = 5;
export const MAX_RESERVES = 3;
export const MAX_DETAILS = 3;

export const KIND_LABEL: Record<CollectionKind, string> = {
  bags_month: "План сумок на месяц",
  jackets_season: "Доска курток на сезон",
  custom: "Своя подборка",
};

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  draft: "Черновик",
  saved: "Сохранена",
  archived: "В архиве",
};

export const REPLACE_REASONS: Record<ReplaceReason, string> = {
  repeats_assortment: "Повторяет наш ассортимент",
  shape: "Не нравится форма",
  audience: "Не наша аудитория",
  weak_evidence: "Слабые подтверждения",
};

export function isReplaceReason(value: unknown): value is ReplaceReason {
  return typeof value === "string" && value in REPLACE_REASONS;
}

export function isCollectionKind(value: unknown): value is CollectionKind {
  return typeof value === "string" && value in KIND_LABEL;
}

export function kindForDirection(direction: AssortmentDirection): CollectionKind {
  return direction === "bags" ? "bags_month" : "jackets_season";
}

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** «2026-11» для месяца, следующего за датой со сдвигом offset. */
export function monthPeriod(now: Date, offset = 0): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Сезоны: SS — весна–лето, AW — осень–зима. Предлагаем три ближайших после текущего. */
export function seasonOptions(now: Date): Array<{ period: string; label: string }> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const out: Array<{ period: string; label: string }> = [];
  let y = year;
  let ss = month < 6 ? false : true; // в первой половине года готовим осень–зиму, во второй — весну–лето следующего
  if (ss) y += 1;
  for (let i = 0; i < 3; i++) {
    out.push({ period: `${y}-${ss ? "SS" : "AW"}`, label: `${ss ? "весна–лето" : "осень–зима"} ${y}` });
    if (ss) ss = false;
    else {
      ss = true;
      y += 1;
    }
  }
  return out;
}

export function periodLabel(period: string | null): string {
  if (!period) return "";
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  const season = period.match(/^(\d{4})-(SS|AW)$/);
  if (season) return `${season[2] === "SS" ? "весна–лето" : "осень–зима"} ${season[1]}`;
  return period;
}

export function defaultTitle(direction: AssortmentDirection, period: string): string {
  return `${direction === "bags" ? "Сумки" : "Куртки"} · ${periodLabel(period)}`;
}

export function isValidPeriod(kind: CollectionKind, period: string): boolean {
  if (kind === "bags_month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  if (kind === "jackets_season") return /^\d{4}-(SS|AW)$/.test(period);
  return period.length <= 40;
}

/**
 * Ключ конструкции: бренд + название модели без расцветки.
 * «Boky - Textured Camel» и «Boky - Textured Black» у Polène — одна идея.
 */
export function constructionKey(ref: { brand: string | null; title: string | null }): string {
  return `${(ref.brand ?? "").toLowerCase().trim()}|${constructionHead(ref.title)}`;
}

/**
 * Название модели без расцветки: до « - Black», до запятой, без «in black».
 * Общее правило для ключа конструкции (подборки, уроки) и ключа модели каталога.
 */
export function constructionHead(title: string | null | undefined): string {
  const lower = (title ?? "").toLowerCase().replace(/ё/g, "е");
  return stripColorTail(lower.split(/\s+[-–—|]\s+|,\s+/)[0].replace(/\s+/g, " ").trim());
}

/**
 * Расцветка в конце названия на манер ASOS: «… bomber jacket in ecru» и
 * «… in black» — одна модель. Срезаем «in <1–3 слова>», если до него
 * осталось хотя бы три слова (иначе «Bag in leather» превратилось бы в «bag»).
 */
export function stripColorTail(title: string): string {
  const match = title.match(/^(.*\S)\s+in\s+[\p{L}\d'&/-]+(?:\s+[\p{L}\d'&/-]+){0,2}$/u);
  if (!match) return title;
  return match[1].split(/\s+/).length >= 3 ? match[1] : title;
}

export interface PlanItemLite {
  id: string;
  referenceId: string;
  slot: number | null;
  isReserve: boolean;
  brand: string | null;
  title: string | null;
}

export interface PlanProgress {
  main: number;
  reserves: number;
  target: number | null;
  label: string;
  freeSlots: number[];
}

export function planProgress(kind: CollectionKind, items: PlanItemLite[]): PlanProgress {
  const main = items.filter((i) => !i.isReserve);
  const reserves = items.filter((i) => i.isReserve).length;
  if (kind !== "bags_month") {
    return { main: main.length, reserves, target: null, label: `${main.length} ${modelsWord(main.length)}`, freeSlots: [] };
  }
  const taken = new Set(main.map((i) => i.slot));
  const freeSlots = Array.from({ length: BAGS_MAIN_SLOTS }, (_, i) => i + 1).filter((slot) => !taken.has(slot));
  const label = `${main.length} из ${BAGS_MAIN_SLOTS}${reserves > 0 ? ` · резерв ${reserves}` : ""}`;
  return { main: main.length, reserves, target: BAGS_MAIN_SLOTS, label, freeSlots };
}

export function modelsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "модель";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "модели";
  return "моделей";
}

/** Куда встанет новый кандидат: выбранный или первый свободный слот, резерв или некуда. */
export function placementFor(kind: CollectionKind, items: PlanItemLite[], asReserve: boolean, preferredSlot: number | null = null): { slot: number | null; isReserve: boolean } | null {
  if (kind !== "bags_month") return { slot: null, isReserve: asReserve };
  const progress = planProgress(kind, items);
  if (!asReserve && preferredSlot !== null && progress.freeSlots.includes(preferredSlot)) return { slot: preferredSlot, isReserve: false };
  if (!asReserve && progress.freeSlots.length > 0) return { slot: progress.freeSlots[0], isReserve: false };
  if (progress.reserves < MAX_RESERVES) return { slot: null, isReserve: true };
  return null;
}

/** Та же конструкция уже в подборке — расцветка не считается новой идеей. */
export function sameConstruction(items: PlanItemLite[], candidate: { brand: string | null; title: string | null; referenceId?: string }): PlanItemLite | null {
  const key = constructionKey(candidate);
  return items.find((i) => i.referenceId !== candidate.referenceId && constructionKey(i) === key) ?? null;
}

export interface ItemBrief {
  differences: string;
  questions: string;
  season_fit: string;
}

export const EMPTY_BRIEF: ItemBrief = { differences: "", questions: "", season_fit: "" };

export class CollectionInputError extends Error {}

const clean = (value: unknown, max: number, label: string): string => {
  if (value == null) return "";
  if (typeof value !== "string") throw new CollectionInputError(`${label}: нужен текст.`);
  const text = value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > max) throw new CollectionInputError(`${label}: не длиннее ${max} знаков.`);
  if (containsMoney(text)) throw new CollectionInputError(`${label}: цены и деньги в задании не пишем.`);
  return text;
};

export interface ItemPatch {
  idea?: string | null;
  details?: string[];
  nextStep?: string | null;
  brief?: ItemBrief;
}

/** Правка кандидата: идея, 1–3 детали, следующий шаг и поля задания. */
export function parseItemPatch(raw: unknown): ItemPatch {
  const body = (raw ?? {}) as Record<string, unknown>;
  const patch: ItemPatch = {};
  if ("idea" in body) patch.idea = clean(body.idea, 120, "Идея") || null;
  if ("nextStep" in body) patch.nextStep = clean(body.nextStep, 300, "Следующий шаг") || null;
  if ("details" in body) {
    const list = Array.isArray(body.details) ? body.details : typeof body.details === "string" ? body.details.split(/\n|;/) : [];
    const details = list.map((d) => clean(d, 120, "Деталь")).filter(Boolean);
    if (details.length > MAX_DETAILS) throw new CollectionInputError(`Отличительных деталей — не больше ${MAX_DETAILS}.`);
    patch.details = details;
  }
  if ("brief" in body) {
    const brief = (body.brief ?? {}) as Record<string, unknown>;
    patch.brief = {
      differences: clean(brief.differences, 600, "Отличия нашей модели"),
      questions: clean(brief.questions, 600, "Вопросы к образцу"),
      season_fit: clean(brief.season_fit, 300, "Сезон и аудитория"),
    };
  }
  return patch;
}

export function cleanResponsible(value: unknown): string | null {
  return clean(value, 120, "Ответственный") || null;
}

export function cleanTitle(value: unknown): string {
  const title = clean(value, 120, "Название");
  if (!title) throw new CollectionInputError("Название подборки не может быть пустым.");
  return title;
}

/** Снимок сохранённой версии — из него и только из него собирается экспорт. */
export interface BriefSnapshot {
  collection: { id: string; title: string; direction: AssortmentDirection; kind: CollectionKind; period: string | null; responsible: string | null; version: number; savedAt: string; savedBy: string };
  items: Array<{
    referenceId: string;
    position: string;
    title: string;
    brand: string | null;
    article: string | null;
    sourceUrl: string;
    idea: string | null;
    details: string[];
    differences: string;
    questions: string;
    seasonFit: string;
    nextStep: string | null;
    observed: string[];
    missing: string[];
    attributes: Array<{ label: string; value: string }>;
  }>;
}

export function itemPosition(slot: number | null, isReserve: boolean, index: number): string {
  if (isReserve) return `Резерв ${index}`;
  return slot ? `Модель ${slot}` : `Модель ${index}`;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** CSV для Excel: разделитель «;», BOM — чтобы кириллица открылась без мусора. */
export function briefCsv(snapshot: BriefSnapshot): string {
  const header = ["Позиция", "Модель", "Бренд-референс", "Артикул", "Ссылка", "Идея", "Детали для изучения", "Отличия нашей модели (идея разработки)", "Вопросы к образцу", "Сезон и аудитория", "Что наблюдается", "Каких фактов нет", "Следующий шаг"];
  const rows = snapshot.items.map((item) => [
    item.position, item.title, item.brand ?? "", item.article ?? "", item.sourceUrl, item.idea ?? "", item.details.join("; "),
    item.differences, item.questions, item.seasonFit, item.observed.join("; "), item.missing.join("; "), item.nextStep ?? "",
  ]);
  return "﻿" + [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(";")).join("\r\n") + "\r\n";
}

/** Доска курток: подтип → силуэт (длина · объём); без признака — отдельная группа. */
export function jacketGroups<T extends { attributes: Record<string, string | null> }>(items: T[]): Array<{ subtype: string; groups: Array<{ silhouette: string; items: T[] }> }> {
  const bySubtype = new Map<string, Map<string, T[]>>();
  for (const item of items) {
    const subtype = item.attributes.subtype || "Подтип не указан";
    const silhouette = [item.attributes.length, item.attributes.volume].filter(Boolean).join(" · ") || "Силуэт не указан";
    const groups = bySubtype.get(subtype) ?? new Map<string, T[]>();
    groups.set(silhouette, [...(groups.get(silhouette) ?? []), item]);
    bySubtype.set(subtype, groups);
  }
  const last = (label: string) => label.endsWith("не указан");
  return [...bySubtype.entries()]
    .sort(([a], [b]) => Number(last(a)) - Number(last(b)) || a.localeCompare(b, "ru"))
    .map(([subtype, groups]) => ({
      subtype,
      groups: [...groups.entries()]
        .sort(([a], [b]) => Number(last(a)) - Number(last(b)) || a.localeCompare(b, "ru"))
        .map(([silhouette, list]) => ({ silhouette, items: list })),
    }));
}
