// Канон СТАТИЧНОГО контента завода (новая линия рядом с видео-рилсами). Чистые, код-вынуждаемые константы
// из разведки рынка (docs/factory-static-content-intel.md §3) — единый источник для Remotion StaticV1 + роута.
// Принцип: «одно дизайн-намерение → N экспортов» (карточка WB/Ozon 3:4, Pinterest-пин 2:3, VK/IG 4:5, карусель).
// Чистый модуль (без React/fal) → юнит-тестируемо (staticCanon.test.mts).

export type StaticFormat = "card_3x4" | "pin_2x3" | "ig_4x5" | "ig_carousel";
export const DEFAULT_STATIC_FORMAT: StaticFormat = "card_3x4";

export interface FormatSpec {
  format: StaticFormat;
  w: number;          // px
  h: number;
  marginX: number;    // safe-зона лево/право
  marginY: number;    // safe-зона верх/низ
  platform: string;   // куда экспортируем (для SEO-слоя/деплинка)
  note: string;
}

// Размеры/safe-зоны выверены разведкой. Pinterest 2:3 — non-negotiable; карточка WB/Ozon 3:4 = highest RU ROI.
export const FORMATS: Record<StaticFormat, FormatSpec> = {
  card_3x4: { format: "card_3x4", w: 1080, h: 1440, marginX: 80, marginY: 96, platform: "wb_ozon_card", note: "Инфографика карточки WB/Ozon — первые 5 слайдов несут всё (71% не листают дальше)" },
  pin_2x3:  { format: "pin_2x3",  w: 1000, h: 1500, marginX: 100, marginY: 150, platform: "pinterest", note: "Pinterest-пин (бонус-канал для РФ). bottom-right — мёртвая зона (иконка Lens)" },
  ig_4x5:   { format: "ig_4x5",   w: 1080, h: 1350, marginX: 96, marginY: 110, platform: "instagram_vk", note: "IG/VK фид-пост и слайд карусели" },
  ig_carousel: { format: "ig_carousel", w: 1080, h: 1350, marginX: 96, marginY: 110, platform: "instagram_carousel", note: "IG-карусель: hook-слайд → value → CTA (рендерится N стиллов)" },
};

export function specFor(format: StaticFormat): FormatSpec {
  return FORMATS[format] || FORMATS[DEFAULT_STATIC_FORMAT];
}

// Палитра: графит-канон завода (как BRoll) + тёплые акценты (разведка: тёплый/яркий фон = >3× repins).
export const PALETTE = {
  graphiteA: "#0e0f12",
  graphiteB: "#15171a",
  ink: "#f2f3f5",
  inkDark: "#14161a",
  muted: "rgba(242,243,245,0.55)",
};
// акцент→цель (разведка §3): тёплые (red/orange/pink) = reach/repins; cool (blue/green) = save-rate.
export const ACCENTS: Record<string, string> = {
  terracotta: "#d9603b", cherry: "#d12f4a", mustard: "#e0a92e", coral: "#ff5a5f", // warm → reach
  lime: "#a3e635", cyan: "#22d3ee", violet: "#a78bfa", // cool → saves
};
export const WARM_ACCENTS = ["terracotta", "cherry", "mustard", "coral"];
export function accentFor(objective: "reach" | "saves" = "reach", idx = 0): string {
  const pool = objective === "saves" ? ["lime", "cyan", "violet"] : WARM_ACCENTS;
  return ACCENTS[pool[((idx % pool.length) + pool.length) % pool.length]];
}

// Шрифты — кириллица-безопасные, уже в нашем Remotion (fonts/). НЕ script/decorative (Pinterest не OCR-ит → ключи теряются).
export const FONTS = {
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace", // цены/числа — tabular
  sans: "Montserrat, system-ui, sans-serif",
  display: "Unbounded, Montserrat, system-ui, sans-serif",
};

// Тайп-скейл (7 ступеней, мажорная терция 1.25) на baseline ширине 1000px. scaleType(px, width) масштабирует под холст.
export const TYPE = { hero: 140, headline: 84, subhead: 52, body: 34, caption: 24, legal: 20 };
export function scaleType(basePx: number, width: number): number {
  return Math.round(basePx * (width / 1000));
}
export const TYPE_FLOOR = 24; // caption никогда не ниже ~24px на пине (читаемость в ленте)

// Бюджет текста: оверлей ≤ 20-25% площади холста (минимально-текстовые пины ~ на 20% лучше).
export const TEXT_AREA_MAX = 0.25;

// Хедлайн: ≤7 слов (≤10 абсолют), benefit-framed. Обрезаем (RU-тайтлы длинные).
export const HEADLINE_WORDS_HARD = 7;
export const HEADLINE_WORDS_ABS = 10;
export function fitHeadline(text: string, hard = HEADLINE_WORDS_HARD): string {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= hard) return words.join(" ");
  return words.slice(0, hard).join(" ") + "…";
}

// Pinterest invisible-SEO: title keyword-first ≤100 (видимо ≤40), description 220-232, ≤5 ключей (стаффинг → ниже виральность).
export const SEO = { titleMax: 100, descMin: 220, descMax: 232, keywordsMax: 5 };
export function clampDesc(text: string, max = SEO.descMax): string {
  const t = String(text || "").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

// Контраст: текст НИКОГДА на сыром фото — на solid/scrim плашке. Порог ≥4.5:1 (цель 7:1), large ≥3:1.
export const CONTRAST_MIN = 4.5;
export const CONTRAST_MIN_LARGE = 3.0;
// относит. яркость sRGB (WCAG). hex "#rrggbb".
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2) || "0", 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
// выбрать ink/inkDark для текста на данном фоне так, чтобы пройти порог; вернуть {color, ok}.
export function pickTextColor(bg: string, large = false): { color: string; ratio: number; ok: boolean } {
  const min = large ? CONTRAST_MIN_LARGE : CONTRAST_MIN;
  const light = { color: PALETTE.ink, ratio: contrastRatio(PALETTE.ink, bg) };
  const dark = { color: PALETTE.inkDark, ratio: contrastRatio(PALETTE.inkDark, bg) };
  const best = light.ratio >= dark.ratio ? light : dark;
  return { color: best.color, ratio: Math.round(best.ratio * 10) / 10, ok: best.ratio >= min };
}
