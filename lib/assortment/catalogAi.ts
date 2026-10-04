import { ATTRIBUTE_FIELDS } from "./attributes";
import { FIELD_HINTS, parseAiAttributes, type AiAttributeValue } from "./aiAttributes";
import type { AssortmentDirection } from "./constants";
import { MIN_SOURCE_MODELS, normalizeTitle } from "./forms";
import { isRuSource } from "./ruMarket";

/**
 * Признаки по фото для всего каталога (движок тенденций, этап 2). Чистые функции.
 *
 * Форма по названию (вкладка «Формы») — один признак; длина, объём, воротник,
 * застёжка названием не называются. Здесь — оценка ИИ по фото модели каталога:
 * та же таблица признаков и тот же вопрос к ИИ, что у находок (aiAttributes.ts),
 * но для каталога из тысяч моделей — с учётом расхода: бюджет движка — до $30 в
 * неделю, и он контролируется записью каждого вызова, а не предполагается.
 *
 * Это ОЦЕНКА ИИ — не факт сайта и не ручное подтверждение; чего на фото не видно,
 * ИИ пишет «не видно» и такие модели в долях не участвуют.
 */

export const CATALOG_AI_KIND = "catalog_attributes";
/** Версия вопроса и словаря признаков: поменяли — модели можно разобрать заново. */
export const PROMPT_VERSION = "catalog-v1";
/** Дешёвая модель с картинками: каталог — тысячи вызовов, а не десятки (основная модель панели — Opus). */
export const DEFAULT_CATALOG_MODEL = "claude-haiku-4-5-20251001";

/** Цены моделей, $ за миллион токенов. Модели без записи цены не запускаем — бюджет нечем считать. */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};

export interface CatalogAiConfig {
  model: string;
  price: { in: number; out: number } | null;
  weeklyBudgetUsd: number;
  dailyLimit: number;
  /** Выключатель: ASSORTMENT_CATALOG_AI=off. */
  enabled: boolean;
}

/** Ноль — значение (владелец ставит 0, чтобы остановить расход), а не «не задано»; мусор и минус — значение по умолчанию. */
function nonNegative(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Настройки из окружения: модель, цена, недельный бюджет разбора каталога в $
 * (ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD, по умолчанию 20 из 30 на весь движок), потолок моделей
 * в сутки (300). Бюджет считает только этот сборщик; прочий расход на ИИ (признаки находок,
 * assortment-ai-attributes на основной модели панели) в учёт не входит.
 */
export function catalogAiConfig(env: Record<string, string | undefined> = process.env): CatalogAiConfig {
  const model = env.ASSORTMENT_CATALOG_AI_MODEL?.trim() || DEFAULT_CATALOG_MODEL;
  const priceIn = Number(env.ASSORTMENT_CATALOG_AI_PRICE_IN);
  const priceOut = Number(env.ASSORTMENT_CATALOG_AI_PRICE_OUT);
  const override = Number.isFinite(priceIn) && priceIn > 0 && Number.isFinite(priceOut) && priceOut > 0 ? { in: priceIn, out: priceOut } : null;
  return {
    model,
    price: override ?? MODEL_PRICES[model] ?? null,
    weeklyBudgetUsd: nonNegative(env.ASSORTMENT_CATALOG_AI_WEEKLY_BUDGET_USD, 20),
    dailyLimit: Math.floor(nonNegative(env.ASSORTMENT_CATALOG_AI_DAILY_LIMIT, 300)),
    enabled: (env.ASSORTMENT_CATALOG_AI ?? "").trim().toLowerCase() !== "off",
  };
}

export function costUsd(usage: { inputTokens: number; outputTokens: number }, price: { in: number; out: number }): number {
  return Math.round(((usage.inputTokens * price.in + usage.outputTokens * price.out) / 1_000_000) * 100_000) / 100_000;
}

/** Запас на один вызов для проверки бюджета до ответа: два фото + вопрос ≈ 4 000 токенов на входе, ≤ 600 на выходе. */
export function estimatedCallUsd(price: { in: number; out: number }): number {
  return costUsd({ inputTokens: 4000, outputTokens: 600 }, price);
}

export interface Allowance {
  /** Сколько моделей можно разобрать в этом прогоне — по бюджету недели, потолку суток и размеру прогона. */
  models: number;
  /** run_cap — упёрлись только в размер одного прогона: следующий продолжит, это не нехватка бюджета. */
  reason: "ok" | "budget" | "daily_limit" | "run_cap";
}

/**
 * Сколько вызовов разрешено сейчас. Бюджет — по записанному расходу недели с
 * запасом на один вызов; суточный потолок — по числу вызовов за сегодня.
 */
export function allowance(config: CatalogAiConfig, spentWeekUsd: number, callsToday: number, runCap: number): Allowance {
  if (!config.price) return { models: 0, reason: "budget" };
  const perCall = estimatedCallUsd(config.price);
  const byBudget = Math.floor(Math.max(0, config.weeklyBudgetUsd - spentWeekUsd) / perCall);
  const byDay = Math.max(0, config.dailyLimit - callsToday);
  const models = Math.min(runCap, byBudget, byDay);
  if (models > 0) return { models, reason: "ok" };
  if (byBudget <= 0) return { models: 0, reason: "budget" };
  if (byDay <= 0) return { models: 0, reason: "daily_limit" };
  return { models: 0, reason: "run_cap" };
}

// ---------------------------------------------------------------------------
// Кого разбирать

export interface CatalogHead {
  /** Ключ модели в базе совпал с тем, что считает код: если нет (ключи перепишет ближайший обход), разбирать рано — результат осиротеет. */
  keyStable?: boolean;
  sourceId: string;
  sourceItemId: string;
  modelKey: string;
  direction: AssortmentDirection;
  title: string;
  imageUrls: string[];
  firstSeenAt: string;
}

export interface ExistingResult {
  status: "ok" | "failed";
  attempts: number;
  promptVersion: string;
  takenAt: string;
}

export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 24 * 3600 * 1000;

const keyOf = (sourceId: string, modelKey: string) => `${sourceId}\u0000${modelKey}`;
export { keyOf as resultKey };

/**
 * Очередь разбора. Сначала новые модели (свежие выше), потом повтор неудавшихся
 * (не раньше чем через сутки, не больше трёх попыток), последними — модели, разобранные
 * прежней версией вопроса. Без фото не берём, «Рынок РФ» (топ WB и Lime — ориентир, не
 * референс) — тоже: ИИ на него не тратим.
 */
export function pickCandidates(heads: CatalogHead[], existing: Map<string, ExistingResult>, nowMs: number, limit: number): CatalogHead[] {
  const fresh: CatalogHead[] = [];
  const retry: CatalogHead[] = [];
  const stale: CatalogHead[] = [];
  const seen = new Set<string>();
  for (const head of heads) {
    if (head.imageUrls.length === 0 || isRuSource(head.sourceId) || head.keyStable === false) continue;
    const key = keyOf(head.sourceId, head.modelKey);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = existing.get(key);
    if (!prev) fresh.push(head);
    else if (prev.status === "failed") {
      if (prev.attempts < MAX_ATTEMPTS && nowMs - Date.parse(prev.takenAt) >= RETRY_AFTER_MS) retry.push(head);
    } else if (prev.promptVersion !== PROMPT_VERSION && nowMs - Date.parse(prev.takenAt) >= RETRY_AFTER_MS) stale.push(head);
  }
  const newestFirst = (a: CatalogHead, b: CatalogHead) => b.firstSeenAt.localeCompare(a.firstSeenAt) || a.sourceId.localeCompare(b.sourceId) || a.modelKey.localeCompare(b.modelKey);
  return [...byTurns(fresh.sort(newestFirst)), ...byTurns(retry.sort(newestFirst)), ...byTurns(stale.sort(newestFirst))].slice(0, Math.max(0, limit));
}

/**
 * По кругу между источниками: по одной модели от каждого, внутри источника — свежие первыми. Источник, чьи фото
 * Anthropic не может скачать (сайты за защитой от облаков), иначе стоял бы в голове очереди целиком и съедал каждый
 * прогон, не пуская остальные.
 */
function byTurns(sorted: CatalogHead[]): CatalogHead[] {
  const bySource = new Map<string, CatalogHead[]>();
  for (const head of sorted) {
    const list = bySource.get(head.sourceId) ?? [];
    list.push(head);
    bySource.set(head.sourceId, list);
  }
  const lanes = [...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
  const out: CatalogHead[] = [];
  for (let round = 0; out.length < sorted.length; round += 1) {
    for (const lane of lanes) if (round < lane.length) out.push(lane[round]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Хранение признаков

/** Компактная запись признака в базе: v — значение, nv — «не видно», c — уверенность. */
export interface StoredAttr {
  v: string | null;
  nv?: true;
  c?: number;
}
export type StoredAttributes = Record<string, StoredAttr>;

export function packAttributes(parsed: Record<string, AiAttributeValue>): StoredAttributes {
  const out: StoredAttributes = {};
  for (const [key, ai] of Object.entries(parsed)) {
    const entry: StoredAttr = { v: ai.notVisible ? null : ai.value };
    if (ai.notVisible) entry.nv = true;
    if (ai.confidence !== null) entry.c = Math.round(ai.confidence * 100) / 100;
    out[key] = entry;
  }
  return out;
}

/** Ответ ИИ → запись; null, если ни одного признака раздела не разобралось. */
export function parseCatalogAnswer(direction: AssortmentDirection, text: string): StoredAttributes | null {
  const parsed = parseAiAttributes(direction, text);
  return Object.keys(parsed).length > 0 ? packAttributes(parsed) : null;
}

// ---------------------------------------------------------------------------
// Отчёт по признакам

/** Не сводим в доли: цвет и «сочетания деталей» — свободный текст, фактура — описание вида. */
const FREE_TEXT_FIELDS = new Set(["color", "details", "texture"]);
const OTHER = "другое";

/** Слова словаря признака из подсказок вопроса к ИИ — в том виде, в каком их показываем; пусто — признак описательный. */
export function fieldVocabulary(key: string): string[] {
  const hint = FIELD_HINTS[key];
  if (!hint || FREE_TEXT_FIELDS.has(key)) return [];
  const out: string[] = [];
  for (const raw of hint.split(/[,;]/)) {
    const term = raw.replace(/[«»"…]/g, "").replace(/^только вид:/, "").trim().toLowerCase();
    if (term.length < 2) continue;
    // «вытянутая по горизонтали/вертикали» — два значения, а не одно длинное.
    if (/горизонтали\/вертикали$/.test(term)) out.push(term.replace("горизонтали/вертикали", "горизонтали"), term.replace("горизонтали/вертикали", "вертикали"));
    else out.push(term);
  }
  return out;
}

/** Типичные формулировки, которые словарь по основам не поймает: «без капюшона», «съёмный капюшон». Порядок важен — первый совпавший. */
const ALIASES: Record<string, Array<[RegExp, string]>> = {
  hood: [
    [/(^|\s)(без капюшон|нет капюшон|капюшона нет|капюшон отсутствует)/, "нет"],
    [/(^|\s)не ?съемн/, "есть"],
    [/съемн/, "съёмный"],
    [/капюшон/, "есть"],
  ],
};

const NEGATIONS = new Set(["не", "без", "нет", "ни"]);
const STEM = 4;

const words = (text: string) => normalizeTitle(text).split(/[^а-яa-z0-9]+/).filter(Boolean);
/** Основа слова: до четырёх букв («прямой» = «прямая» = «прямые»); короткие слова — целиком. */
const stem = (word: string) => (word.length <= STEM ? word : word.slice(0, STEM));

/**
 * Совпадение термина словаря со значением: каждое слово термина — начало какого-то слова
 * значения, по порядку. Отрицание перед словом («не приталенная», «не съёмный») совпадением не
 * считается; «небольшая» не похожа на «большая» (сравнение по началу слова, не по вхождению).
 * Возвращает позицию первого совпавшего слова или -1.
 */
function matchAt(valueWords: string[], termWords: string[]): number {
  outer: for (let start = 0; start + termWords.length <= valueWords.length; start += 1) {
    for (let i = 0; i < termWords.length; i += 1) {
      const v = valueWords[start + i];
      const t = termWords[i];
      // Слово термина короче основы («до», «на») — только целиком, иначе «до» ловит «договор».
      if (t.length <= STEM ? v !== t : !v.startsWith(stem(t))) continue outer;
    }
    const before = start > 0 ? valueWords[start - 1] : null;
    if (before && NEGATIONS.has(before) && !NEGATIONS.has(termWords[0])) continue;
    return start;
  }
  return -1;
}

/** Значение признака → слово словаря или «другое». Сравнение без «й»/«ё»-различий, показ — как в словаре. */
export function canonicalValue(key: string, raw: string): string {
  const value = normalizeTitle(raw);
  if (!value) return OTHER;
  for (const [re, canonical] of ALIASES[key] ?? []) if (re.test(value)) return canonical;
  const valueWords = words(raw);
  let best: { term: string; size: number; length: number; pos: number } | null = null;
  for (const term of fieldVocabulary(key)) {
    const termWords = words(term);
    if (termWords.length === 0) continue;
    const pos = matchAt(valueWords, termWords);
    if (pos < 0) continue;
    // Что названо раньше — главное («накладные на молнии» — накладные, «свободная, оверсайз» — свободная);
    // с одной позиции — где слов больше (точнее), потом что длиннее.
    const better = !best || pos < best.pos || (pos === best.pos && (termWords.length > best.size || (termWords.length === best.size && term.length > best.length)));
    if (better) best = { term, size: termWords.length, length: term.length, pos };
  }
  return best?.term ?? OTHER;
}

export interface TraitModel {
  sourceId: string;
  sourceName: string;
  attributes: StoredAttributes;
}

export interface TraitValue {
  value: string;
  models: number;
  /** Доля среди моделей, где признак виден, % — сырая. */
  share: number;
  /** Средняя доля по источникам с достаточным числом разобранных моделей, %. */
  avgSourceShare: number | null;
  sources: number;
}

export interface TraitField {
  key: string;
  label: string;
  /** Моделей, у которых признак виден; «не видно» и пропущенный не входят. */
  visible: number;
  notVisible: number;
  /** Значения словаря, по убыванию того, что показано (средняя по источникам, иначе сырая доля). */
  values: TraitValue[];
  /** Формулировки вне словаря — отдельно и всегда: они не должны теряться за обрезкой списка. */
  other: TraitValue | null;
}

export interface PhotoTraitsReport {
  direction: AssortmentDirection;
  /** Разобрано моделей из текущего каталога. */
  analyzed: number;
  /** Моделей каталога, которые можно разобрать: с фото, без «Рынка РФ». */
  catalog: number;
  coverage: number;
  sourcesInAverage: number;
  fields: TraitField[];
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);
const MAX_VALUES = 8;

/**
 * Доли значений признаков по разобранным моделям. Модель с «не видно» по признаку
 * в его долях не участвует. Средняя по источникам — как у форм: большой каталог
 * не решает за остальные; в среднюю идут источники с ≥ 10 разобранными моделями.
 */
export function buildPhotoTraits(direction: AssortmentDirection, models: TraitModel[], catalog: number): PhotoTraitsReport {
  const perSourceTotal = new Map<string, number>();
  for (const m of models) perSourceTotal.set(m.sourceId, (perSourceTotal.get(m.sourceId) ?? 0) + 1);
  const averaged = [...perSourceTotal.entries()].filter(([, n]) => n >= MIN_SOURCE_MODELS).map(([id]) => id);

  const fields: TraitField[] = [];
  for (const field of ATTRIBUTE_FIELDS[direction]) {
    if (FREE_TEXT_FIELDS.has(field.key)) continue;
    const counts = new Map<string, { models: number; perSource: Map<string, number> }>();
    const visibleBySource = new Map<string, number>();
    let visible = 0;
    let notVisible = 0;
    for (const m of models) {
      const attr = m.attributes[field.key];
      if (!attr) continue;
      if (attr.nv || !attr.v) {
        notVisible += 1;
        continue;
      }
      visible += 1;
      visibleBySource.set(m.sourceId, (visibleBySource.get(m.sourceId) ?? 0) + 1);
      const value = canonicalValue(field.key, attr.v);
      const entry = counts.get(value) ?? { models: 0, perSource: new Map<string, number>() };
      entry.models += 1;
      entry.perSource.set(m.sourceId, (entry.perSource.get(m.sourceId) ?? 0) + 1);
      counts.set(value, entry);
    }
    if (visible === 0) continue;
    const usable = averaged.filter((id) => (visibleBySource.get(id) ?? 0) > 0);
    const values: TraitValue[] = [...counts.entries()].map(([value, entry]) => ({
      value,
      models: entry.models,
      share: pct(entry.models, visible),
      avgSourceShare: usable.length > 0
        ? Math.round((usable.reduce((sum, id) => sum + (entry.perSource.get(id) ?? 0) / (visibleBySource.get(id) ?? 1), 0) / usable.length) * 1000) / 10
        : null,
      sources: entry.perSource.size,
    }));
    // Порядок — по тому, что показано (средняя по источникам, иначе сырая доля); «другое» — отдельно.
    const shown = (v: TraitValue) => v.avgSourceShare ?? v.share;
    const named = values.filter((v) => v.value !== OTHER).sort((a, b) => shown(b) - shown(a) || b.models - a.models || a.value.localeCompare(b.value));
    fields.push({ key: field.key, label: field.label, visible, notVisible, values: named.slice(0, MAX_VALUES), other: values.find((v) => v.value === OTHER) ?? null });
  }
  return {
    direction,
    analyzed: models.length,
    catalog,
    coverage: pct(models.length, catalog),
    sourcesInAverage: averaged.length,
    fields,
  };
}

/** Показываем блок, когда разобрано достаточно моделей, чтобы доли что-то значили. */
export const MIN_MODELS_FOR_TRAITS = 30;
