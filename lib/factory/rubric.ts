// Рубрика «лучше конкурентов» — единый стандарт оценки коротких вертикальных видео.
// Источник правды сразу для трёх потребителей: само-ОТК идей (scripts), ОТК ролика
// (video-critic) и будущего эталонного прогона (gauntlet). 5 осей × якоря × веса (niche×mode) × флоры.
// Модель ставит по-осевые баллы 1–5; взвешенный балл, флоры и вердикт считает сервер (детерминированно).

export type ContentMode = "audience" | "sell";
export type RubricNiche = "clothing" | "toys" | "cosmetics" | "default";
export interface AxisScores { hook: number; retention: number; native: number; brand: number; cta: number }

export const QA_PASS = 7; // score(1-10) ≥ → ok (совпадает с QA_THRESHOLD в standard.ts)

// --- веса осей: mode × niche, сумма каждой строки = 1.0 ---
// Аудиторный режим тянет на хук+удержание; продающий — на бренд/товар+CTA (но нативность держит флор).
const WEIGHTS: Record<ContentMode, Record<RubricNiche, AxisScores>> = {
  audience: {
    clothing:  { hook: 0.32, retention: 0.28, native: 0.22, brand: 0.10, cta: 0.08 },
    toys:      { hook: 0.35, retention: 0.25, native: 0.20, brand: 0.10, cta: 0.10 },
    cosmetics: { hook: 0.30, retention: 0.30, native: 0.20, brand: 0.12, cta: 0.08 },
    default:   { hook: 0.32, retention: 0.28, native: 0.22, brand: 0.10, cta: 0.08 },
  },
  sell: {
    clothing:  { hook: 0.25, retention: 0.18, native: 0.15, brand: 0.25, cta: 0.17 },
    toys:      { hook: 0.27, retention: 0.18, native: 0.15, brand: 0.23, cta: 0.17 },
    cosmetics: { hook: 0.25, retention: 0.20, native: 0.15, brand: 0.23, cta: 0.17 },
    default:   { hook: 0.25, retention: 0.18, native: 0.15, brand: 0.25, cta: 0.17 },
  },
};

export function weightsFor(mode: ContentMode, niche: RubricNiche): AxisScores {
  const m = WEIGHTS[mode] || WEIGHTS.audience;
  return m[niche] || m.default;
}

// --- хард-флоры: ось ниже минимума → вердикт не может быть ok (режется до rework/trash) ---
// Любой ролик: хук≥3, нативность≥3. Audience держит фоновый бренд (≥2), Sell — читаемый товар (≥4).
// basis='text' (предфильтр по тексту сценария, без кадров): визуальные оси native/brand из текста НЕ судятся —
// флор считаем ТОЛЬКО по хуку (единственная ось, что честно читается из текста).
export type RubricBasis = "frames" | "text";
export function floorsFor(mode: ContentMode, basis: RubricBasis = "frames"): Partial<AxisScores> {
  if (basis === "text") return { hook: 3 };
  return mode === "sell"
    ? { hook: 3, native: 3, brand: 4 }
    : { hook: 3, native: 3, brand: 2 };
}

// Ниша из артикула/названия (грубое сопоставление под бренды селлера).
export function nicheFromArticle(article = "", name = ""): RubricNiche {
  const s = `${article} ${name}`.toLowerCase();
  if (/^nv|^ht|куртк|ветровк|пухов|пальто|плащ|жилет|одежд/.test(s)) return "clothing";
  if (/^tt|пистолет|игрушк|бластер|toy|water.gun/.test(s)) return "toys";
  if (/крем|сыворотк|маск|косметик|уход|тонер|патч|cosmet|cream|serum|skincare|spf|sunscreen|collagen|коллаген|retinol|niacinamide|hyaluron|тональн|пудра|помад|туш|тени/.test(s)) return "cosmetics";
  return "default";
}

// --- детерминированный вердикт по осям (считает сервер, не модель) ---
export interface RubricResult { weighted: number; score: number; verdict: "ok" | "rework" | "trash"; floorFail: string[] }

export function scoreRubric(axes: AxisScores, mode: ContentMode, niche: RubricNiche, basis: RubricBasis = "frames"): RubricResult {
  const w = weightsFor(mode, niche);
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));
  const a: AxisScores = {
    hook: clamp(axes.hook), retention: clamp(axes.retention), native: clamp(axes.native),
    brand: clamp(axes.brand), cta: clamp(axes.cta),
  };
  // 5 баллов × сумма весов(=1) = 5 → ×20 = 100
  const weighted = Math.round((a.hook * w.hook + a.retention * w.retention + a.native * w.native + a.brand * w.brand + a.cta * w.cta) * 20);
  const score = Math.max(1, Math.min(10, Math.round(weighted / 10)));
  const floors = floorsFor(mode, basis);
  const floorFail: string[] = [];
  (Object.keys(floors) as (keyof AxisScores)[]).forEach((k) => { if (a[k] < (floors[k] as number)) floorFail.push(k); });
  let verdict: "ok" | "rework" | "trash";
  if (floorFail.length) verdict = score >= 4 ? "rework" : "trash";
  else verdict = score >= QA_PASS ? "ok" : score >= 4 ? "rework" : "trash";
  return { weighted, score, verdict, floorFail };
}

// --- текст рубрики для промпта (оси A–D общие, E зависит от режима) ---
export const RUBRIC_AXES_AD = `ОСИ ОЦЕНКИ (каждую ставь целым баллом 1–5 строго по якорям):
A. ХУК (0–3 сек): 5 — первый кадр паттерн-брейк (неожиданный визуал/эмоция/результат), за 1 сек ясно «зачем смотреть», есть текст-хук на экране; 3 — понятно про товар, но без интриги/эмоции, «обычный обзор»; 1 — статичный товар/лого/«здравствуйте», скролл не останавливает.
B. УДЕРЖАНИЕ/ТЕМП: 5 — кадр/ракурс меняется каждые 1.5–3 сек ИЛИ есть сильный фактор новизны/WTF (необычный формат/продукт сам держит просмотр — напр. «тон в баллончике», цвето-меняющий стик, тест на UV-камере), петля любопытства (обещание/новизна раскрывается к финалу), субтитры, ни одной мёртвой секунды; 3 — динамика есть, но провисает в середине или хук закрылся слишком рано; 1 — один статичный план/говорящая голова на весь ролик, без субтитров.
C. НАТИВНОСТЬ/DE-AI: 5 — выглядит как органик-съёмка живого человека (особенно если грунтовано на реальном кадре модели), копирайт живой, нет AI-артефактов, трендовый/живой звук; 3 — чуть «рекламно» или чуть «ИИ» (шаблонные фразы, стоковый звук), терпимо; 1 — явная реклама-карточка или AI-слоп (кривые руки/искажение товара, голос-робот, канцелярит).
D. БРЕНД/ТОВАР: 5 — товар узнаётся, его выгода считывается без слов, бренд-войс выдержан, персона консистентна с другими роликами; 3 — товар виден, но выгода не читается или войс размыт; 1 — товар не идентифицируется или подменён ради «вируса».`;

export const RUBRIC_CTA: Record<ContentMode, string> = {
  audience: `E. CTA (режим AUDIENCE — растим охват/подписки): 5 — естественный мотив сохранить/переслать/подписаться («сохрани, продолжение в профиле»), БЕЗ ссылки на WB; 3 — CTA вялый или его нет; 1 — впихнут WB-CTA (в этом режиме это ШТРАФ: режет охват и нативность).`,
  sell: `E. CTA (режим SELL — ведём на WB): 5 — один чистый понятный переход на WB (по точному названию/артикулу) ПОСЛЕ ценности, не в лоб; 3 — CTA мутный/слишком рано/двойной (и подписка, и WB сразу); 1 — нет внятного действия или агрессивный спам-CTA.`,
};

export function rubricPrompt(mode: ContentMode): string {
  return `${RUBRIC_AXES_AD}\n${RUBRIC_CTA[mode] || RUBRIC_CTA.audience}`;
}
