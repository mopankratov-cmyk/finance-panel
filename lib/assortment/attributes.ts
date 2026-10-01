/**
 * Признаки модели и их происхождение. Чистые функции.
 *
 * ТЗ §6: опубликованный факт, оценка ИИ и ручное подтверждение — разные вещи;
 * для каждого признака храним, откуда он, и поддерживаем «не видно». Ручная
 * правка не стирает исходное значение — оно остаётся в `previous`.
 */

import type { AssortmentDirection } from "./constants";

export type AttributeOrigin = "published" | "ai_estimate" | "manual" | "unknown";

export interface AttributeEntry {
  value: string | string[] | null;
  origin: AttributeOrigin;
  not_visible?: boolean;
  reviewer?: string;
  reviewed_at?: string;
  previous?: Omit<AttributeEntry, "previous">;
}

export type Attributes = Record<string, AttributeEntry>;

export interface AttributeField {
  key: string;
  label: string;
}

/** Порядок и названия признаков — из таблицы ТЗ §6 по категориям. */
export const ATTRIBUTE_FIELDS: Record<AssortmentDirection, AttributeField[]> = {
  jackets: [
    { key: "subtype", label: "Подтип" },
    { key: "length", label: "Длина" },
    { key: "volume", label: "Объём" },
    { key: "shoulder", label: "Посадка плеча" },
    { key: "hem", label: "Линия низа" },
    { key: "collar", label: "Воротник" },
    { key: "hood", label: "Капюшон" },
    { key: "closure", label: "Застёжка" },
    { key: "pockets", label: "Карманы" },
    { key: "sleeves", label: "Рукава" },
    { key: "quilting", label: "Стёжка" },
    { key: "texture", label: "Видимая фактура" },
    { key: "color", label: "Цвет" },
    { key: "details", label: "Сочетания деталей" },
  ],
  bags: [
    { key: "silhouette", label: "Силуэт" },
    { key: "proportions", label: "Пропорции" },
    { key: "rigidity", label: "Жёсткость формы" },
    { key: "carry", label: "Способ ношения" },
    { key: "handles", label: "Ручки и ремень" },
    { key: "flap", label: "Клапан" },
    { key: "closure", label: "Застёжка" },
    { key: "pockets", label: "Карманы" },
    { key: "hardware", label: "Фурнитура" },
    { key: "texture", label: "Фактура" },
    { key: "color", label: "Цвет" },
    { key: "decor", label: "Декор" },
  ],
};

/** Признаки, которые приходят с карточки сайта при импорте. */
const COMMON_FIELDS: AttributeField[] = [
  { key: "category", label: "Категория на сайте" },
  { key: "colors", label: "Варианты цвета" },
  { key: "note", label: "Заметка" },
];

export const ORIGIN_LABEL: Record<AttributeOrigin, string> = {
  published: "опубликовано на сайте",
  ai_estimate: "оценка ИИ",
  manual: "вручную",
  unknown: "не определено",
};

export function fieldsFor(direction: AssortmentDirection): AttributeField[] {
  return [...ATTRIBUTE_FIELDS[direction], ...COMMON_FIELDS];
}

export function isEditableKey(direction: AssortmentDirection, key: string): boolean {
  return fieldsFor(direction).some((field) => field.key === key);
}

export function formatValue(entry: AttributeEntry | undefined): string | null {
  if (!entry) return null;
  if (entry.not_visible) return "не видно";
  if (Array.isArray(entry.value)) return entry.value.length > 0 ? entry.value.join(", ") : null;
  return entry.value && entry.value.trim() ? entry.value.trim() : null;
}

export interface AttributeRow {
  key: string;
  label: string;
  value: string | null;
  origin: string;
  previous: string | null;
}

/** Строки таблицы признаков: сначала поля категории, затем всё, что пришло с сайта. */
export function attributeRows(direction: AssortmentDirection, attributes: Attributes): AttributeRow[] {
  return fieldsFor(direction).map((field) => {
    const entry = attributes[field.key];
    const previous = entry?.previous ? formatValue(entry.previous as AttributeEntry) : null;
    return {
      key: field.key,
      label: field.label,
      value: formatValue(entry),
      origin: entry ? ORIGIN_LABEL[entry.origin] ?? entry.origin : "не заполнено",
      previous: previous && entry?.previous ? `${ORIGIN_LABEL[entry.previous.origin] ?? entry.previous.origin}: ${previous}` : null,
    };
  });
}

/** Граница ТЗ: в признаки не пишем цены и деньги даже руками. */
// \b в JS не видит границ кириллических слов — границу задаём явно.
const MONEY = /[€$£¥₽]|\d\s*(руб|р\.|eur|usd|rub|cny|юан)|(^|[^а-яёa-z])(цена|цены|цену|ценой|стоимост|price|cost|марж|себестоим)/i;

export class AttributeInputError extends Error {}

export type AttributeEdit =
  | { kind: "set"; value: string }
  | { kind: "not_visible" }
  | { kind: "reset" };

export function parseAttributeEdit(raw: unknown): AttributeEdit {
  const body = (raw ?? {}) as { kind?: unknown; value?: unknown };
  if (body.kind === "not_visible") return { kind: "not_visible" };
  if (body.kind === "reset") return { kind: "reset" };
  if (body.kind === "set" && typeof body.value === "string") {
    const value = body.value.replace(/\s+/g, " ").trim();
    if (!value) return { kind: "reset" };
    if (value.length > 120) throw new AttributeInputError("Значение длиннее 120 знаков — сократите.");
    if (MONEY.test(value)) throw new AttributeInputError("Цены и деньги в модуле не храним — опишите признак словами.");
    return { kind: "set", value };
  }
  throw new AttributeInputError("Непонятная правка признака.");
}

const strip = (entry: AttributeEntry): Omit<AttributeEntry, "previous"> => {
  const { previous: _previous, ...rest } = entry;
  void _previous;
  return rest;
};

/**
 * Применить ручную правку. Исходное значение (с сайта или от ИИ) сохраняется
 * в `previous` и возвращается кнопкой «сбросить».
 */
export function applyAttributeEdit(attributes: Attributes, key: string, edit: AttributeEdit, reviewer: string, now: string): Attributes {
  const next: Attributes = { ...attributes };
  const current = attributes[key];
  const original = current?.origin === "manual" ? current.previous : current ? strip(current) : undefined;
  if (edit.kind === "reset") {
    if (original) next[key] = { ...original };
    else delete next[key];
    return next;
  }
  const entry: AttributeEntry = edit.kind === "set"
    ? { value: edit.value, origin: "manual", reviewer, reviewed_at: now }
    : { value: null, origin: "manual", not_visible: true, reviewer, reviewed_at: now };
  if (original) entry.previous = original;
  next[key] = entry;
  return next;
}

export interface CompareModel {
  id: string;
  name: string;
  attributes: Attributes;
}

export interface CompareResult {
  rows: Array<{ key: string; label: string; values: Array<string | null> }>;
  common: string[];
  differences: string[];
}

const norm = (value: string) => value.toLowerCase().replace(/ё/g, "е").trim();

/**
 * Общее и различия — только из признаков карточек, без домыслов. Признак,
 * которого нет хотя бы у двух моделей, в выводы не попадает.
 */
export function compareModels(direction: AssortmentDirection, models: CompareModel[]): CompareResult {
  const rows = fieldsFor(direction)
    .filter((field) => field.key !== "note")
    .map((field) => ({ key: field.key, label: field.label, values: models.map((m) => formatValue(m.attributes[field.key])) }))
    .filter((row) => row.values.some((v) => v !== null));
  const total = models.length;
  const common: string[] = [];
  const differences: string[] = [];
  for (const row of rows) {
    const known = row.values
      .map((value, index) => ({ value, index }))
      .filter((cell): cell is { value: string; index: number } => cell.value !== null && cell.value !== "не видно");
    if (known.length < 2) continue;
    const groups = new Map<string, { value: string; indexes: number[] }>();
    for (const cell of known) {
      const group = groups.get(norm(cell.value)) ?? { value: cell.value, indexes: [] };
      group.indexes.push(cell.index);
      groups.set(norm(cell.value), group);
    }
    if (groups.size === 1) {
      const only = [...groups.values()][0];
      common.push(only.indexes.length === total
        ? `${row.label}: ${only.value} — у всех`
        : `${row.label}: ${only.value} — у ${only.indexes.length} из ${total}`);
      continue;
    }
    for (const group of groups.values()) {
      if (group.indexes.length >= 2) common.push(`${row.label}: ${group.value} — у ${group.indexes.length} из ${total}`);
      else differences.push(`${row.label}: ${group.value} — только у ${models[group.indexes[0]].name}`);
    }
  }
  return { rows, common, differences };
}
