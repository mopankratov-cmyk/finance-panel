import type { AssortmentDirection } from "./constants";
import { rulesFor } from "./forms";

/**
 * Профиль бренда (движок тенденций, этап 1): аудитория, подходящие и неподходящие
 * формы, сезоны, палитра. Чистые функции.
 *
 * Профиль — решение владельца, а не вывод из данных: движок ничего в него не
 * подставляет. Пустое поле — «не решено», и рекомендации «подходит бренду» без
 * заполненного профиля не строятся (это не «подходит», а «не знаем»). HEATON и
 * NORVIA — два отдельных профиля; артикул HT- бренд не определяет (часть HT-
 * карточек — HEATON, часть — NORVIA), бренд берётся из поля бренда WB.
 */

export interface SeasonOption {
  key: string;
  label: string;
}

export const SEASONS: readonly SeasonOption[] = [
  { key: "spring", label: "Весна" },
  { key: "summer", label: "Лето" },
  { key: "autumn", label: "Осень" },
  { key: "winter", label: "Зима" },
];

export type ProfileStatus = "draft" | "confirmed";

export interface BrandProfile {
  brandKey: string;
  direction: AssortmentDirection;
  displayName: string;
  /** Как бренд назван в поле бренда WB — по нему движок находит свои карточки. Меняется только миграцией. */
  wbBrandNames: string[];
  audience: string | null;
  /** Ключи форм (lib/assortment/forms.ts), которые бренду подходят. */
  fitForms: string[];
  /** Ключи форм, которые бренду не подходят. Не в обоих списках — «не решено». */
  avoidForms: string[];
  seasons: string[];
  palette: string | null;
  notes: string | null;
  sourceRef: string | null;
  status: ProfileStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Три бренда владельца. Названия в WB — из DIRECTION_WB_BRANDS (lib/assortment/wbDemand.ts); остальное пусто: заполняет владелец. */
export const BRAND_DEFAULTS: readonly BrandProfile[] = [
  blank("norvia", "jackets", "NORVIA", ["NORVIA"]),
  blank("heaton", "jackets", "HEATON", ["HEATON"]),
  blank("clerin", "bags", "CLÉRIN", ["CLÉRIN", "CLERIN"]),
];

function blank(brandKey: string, direction: AssortmentDirection, displayName: string, wbBrandNames: string[]): BrandProfile {
  return {
    brandKey, direction, displayName, wbBrandNames,
    audience: null, fitForms: [], avoidForms: [], seasons: [], palette: null, notes: null, sourceRef: null,
    status: "draft", confirmedAt: null, confirmedBy: null, version: 0, updatedAt: null, updatedBy: null,
  };
}

/**
 * Что уже известно из заметок проекта — подсказка владельцу при заполнении, а не
 * значения профиля: не подтверждено, в профиль не попадает, пока владелец не внесёт.
 */
export const BRAND_SOURCE_HINTS: Record<string, string[]> = {
  norvia: [
    "Брендбук 2026: женские куртки «для реальной жизни», ядро — женщины 30–45 (дополнительно 18–30 и 45–65+), средний и средне-премиальный сегмент.",
    "Линейка NV-: демисезонные утеплённые куртки с капюшоном, удлинённые, парка с поясом. Размерная сетка менялась (42–50 → 44–52).",
  ],
  heaton: [
    "Презентация марта 2026: «лёгкие куртки/ветровки», «городской минимализм», средний сегмент. HT-42/80/83 — ветровки.",
    "Зимние HT-955/958 — расширяют ли они профиль бренда, в источниках не сказано.",
  ],
  clerin: [
    "Сумки; на WB 9 моделей. Аудитория и стиль в источниках не зафиксированы.",
  ],
};

export function defaultProfile(brandKey: string): BrandProfile | null {
  return BRAND_DEFAULTS.find((p) => p.brandKey === brandKey) ?? null;
}

/** Формы раздела, которые можно отнести к бренду: конкретные, без общих «куртка» и «сумка». */
export function profileForms(direction: AssortmentDirection): Array<{ key: string; label: string }> {
  return rulesFor(direction).filter((r) => !r.generic).map((r) => ({ key: r.key, label: r.label }));
}

export interface ProfileInput {
  audience?: unknown;
  fitForms?: unknown;
  avoidForms?: unknown;
  seasons?: unknown;
  palette?: unknown;
  notes?: unknown;
  sourceRef?: unknown;
  confirmed?: unknown;
  version?: unknown;
}

export interface ProfilePatch {
  audience: string | null;
  fitForms: string[];
  avoidForms: string[];
  seasons: string[];
  palette: string | null;
  notes: string | null;
  sourceRef: string | null;
  confirmed: boolean;
  version: number;
}

const LIMITS = { audience: 1000, notes: 1000, palette: 300, sourceRef: 300 } as const;

function text(value: unknown, max: number, label: string): { value: string | null } | { error: string } {
  if (value == null || value === "") return { value: null };
  if (typeof value !== "string") return { error: `${label}: нужен текст` };
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length > max) return { error: `${label}: не длиннее ${max} знаков` };
  return { value: clean || null };
}

function keys(value: unknown, allowed: Set<string>, label: string): { value: string[] } | { error: string } {
  if (value == null) return { value: [] };
  if (!Array.isArray(value)) return { error: `${label}: нужен список` };
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item)) return { error: `${label}: неизвестное значение «${String(item).slice(0, 40)}»` };
    if (!out.includes(item)) out.push(item);
  }
  return { value: out };
}

/** Проверка тела запроса: только известные формы и сезоны, тексты по длине, формы не в двух списках сразу. */
export function parseProfileInput(direction: AssortmentDirection, input: ProfileInput): { patch: ProfilePatch } | { error: string } {
  const allowedForms = new Set(profileForms(direction).map((f) => f.key));
  const allowedSeasons = new Set(SEASONS.map((s) => s.key));
  const audience = text(input.audience, LIMITS.audience, "Аудитория");
  if ("error" in audience) return audience;
  const palette = text(input.palette, LIMITS.palette, "Палитра");
  if ("error" in palette) return palette;
  const notes = text(input.notes, LIMITS.notes, "Заметки");
  if ("error" in notes) return notes;
  const sourceRef = text(input.sourceRef, LIMITS.sourceRef, "Источник");
  if ("error" in sourceRef) return sourceRef;
  const fit = keys(input.fitForms, allowedForms, "Подходящие формы");
  if ("error" in fit) return fit;
  const avoid = keys(input.avoidForms, allowedForms, "Неподходящие формы");
  if ("error" in avoid) return avoid;
  const seasons = keys(input.seasons, allowedSeasons, "Сезоны");
  if ("error" in seasons) return seasons;
  const both = fit.value.filter((k) => avoid.value.includes(k));
  if (both.length > 0) return { error: "Одна и та же форма не может быть и подходящей, и неподходящей" };
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 0) return { error: "Не передана версия профиля — обновите страницу" };
  return {
    patch: {
      audience: audience.value, fitForms: fit.value, avoidForms: avoid.value, seasons: seasons.value,
      palette: palette.value, notes: notes.value, sourceRef: sourceRef.value,
      confirmed: input.confirmed === true, version,
    },
  };
}

export interface ProfileCompleteness {
  filled: number;
  total: number;
  missing: string[];
}

/** Что владелец уже решил, чего не хватает; для «можно ли судить, что подходит бренду». */
export function profileCompleteness(profile: Pick<BrandProfile, "audience" | "fitForms" | "avoidForms" | "seasons" | "palette">): ProfileCompleteness {
  const checks: Array<[string, boolean]> = [
    ["аудитория", Boolean(profile.audience)],
    ["формы (подходят / не подходят)", profile.fitForms.length + profile.avoidForms.length > 0],
    ["сезоны", profile.seasons.length > 0],
    ["палитра", Boolean(profile.palette)],
  ];
  return { filled: checks.filter(([, ok]) => ok).length, total: checks.length, missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}

export type FormFit = "fit" | "avoid" | null;

/** Решение профиля по форме; null — «не решено» (в том числе у пустого профиля). */
export function fitFor(profile: Pick<BrandProfile, "fitForms" | "avoidForms">, formKey: string): FormFit {
  if (profile.fitForms.includes(formKey)) return "fit";
  if (profile.avoidForms.includes(formKey)) return "avoid";
  return null;
}

/** Из строки базы (snake_case) в профиль; не хватающее добираем из значений по умолчанию. */
export function profileFromRow(row: Record<string, unknown>): BrandProfile | null {
  const brandKey = typeof row.brand_key === "string" ? row.brand_key : "";
  const base = defaultProfile(brandKey);
  if (!base) return null;
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  const names = list(row.wb_brand_names);
  return {
    ...base,
    displayName: str(row.display_name) ?? base.displayName,
    wbBrandNames: names.length ? names : base.wbBrandNames,
    audience: str(row.audience),
    fitForms: list(row.fit_forms),
    avoidForms: list(row.avoid_forms),
    seasons: list(row.seasons),
    palette: str(row.palette),
    notes: str(row.notes),
    sourceRef: str(row.source_ref),
    status: row.status === "confirmed" ? "confirmed" : "draft",
    confirmedAt: str(row.confirmed_at),
    confirmedBy: str(row.confirmed_by),
    version: Number(row.version) || 0,
    updatedAt: str(row.updated_at),
    updatedBy: str(row.updated_by),
  };
}
