// Билдер спеки b-ролла для агента-«монтажёра». ЧИСТЫЕ функции (без remotion-зависимостей) → тестируемо.
// Агент читает сценарий и выбирает N сильных фраз + подсказки (preset/accent/stat); этот модуль нормализует
// их в валидные props композиции BRoll (remotion/BRoll.tsx) — детерминированно, не ломает рендер.
// Дизайн-канон зафиксирован здесь и в docs/factory-broll-canon.md (графит + 1-2 акцента, моноширинные цифры).

export type BRollPreset = "cascade" | "quote" | "stat";

export interface BRollSpec {
  durationInFrames: number;
  preset: BRollPreset;
  accent: string;
  accent2?: string;
  kicker?: string;
  lines: string[];
  emphasizeIndex?: number;
  stat?: { value: string; label: string };
}

export interface BRollSpecInput {
  phrase: string;                 // сильная фраза из сценария (для cascade/quote)
  preset?: BRollPreset;           // подсказка агента; иначе авто-детект
  accent?: string;                // имя из ACCENTS или hex; иначе — по индексу из палитры
  kicker?: string;                // мелкая верхняя плашка (бренд/рубрика)
  stat?: { value: string; label: string }; // для preset='stat'
  emphasizeLast?: boolean;        // подсветить последнюю строку (дефолт true)
  durationSec?: number;           // дефолт 4с
}

const FPS = 30;
// Палитра канона: тёмный графит + НЕ более 2-3 акцентов на ролик. Имена → hex.
export const ACCENTS: Record<string, string> = {
  orange: "#ff5a1f",
  cyan: "#22d3ee",
  lime: "#a3e635",
  violet: "#a78bfa",
};
const ACCENT_ROTATION = ["orange", "cyan", "lime", "violet"]; // стабильная ротация по индексу клипа

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export function resolveAccent(accent: string | undefined, idx = 0): string {
  if (accent && HEX.test(accent.trim())) return accent.trim();
  if (accent && ACCENTS[accent.trim().toLowerCase()]) return ACCENTS[accent.trim().toLowerCase()];
  return ACCENTS[ACCENT_ROTATION[((idx % ACCENT_ROTATION.length) + ACCENT_ROTATION.length) % ACCENT_ROTATION.length]];
}

// Содержит ли фраза «значимое» число (для авто-выбора preset='stat»).
export function hasStatNumber(text: string): boolean {
  // цифра в начале токена (8 часов / 3 минуты / 90% / 2990₽) — в сценарной фразе это почти всегда «стат под крупный показ»
  return /(^|\s)\d/.test(String(text || ""));
}

// Авто-детект preset: число → stat; короткая ударная (≤3 слова) → quote; иначе → cascade.
export function detectPreset(phrase: string): BRollPreset {
  const t = String(phrase || "").trim();
  if (hasStatNumber(t)) return "stat";
  if (t.split(/\s+/).filter(Boolean).length <= 3) return "quote";
  return "cascade";
}

// Разбить фразу на 1-4 коротких строки (баланс по длине, не рвём слова). Для cascade-каскада.
export function splitToLines(phrase: string, maxLines = 4, maxLineChars = 18): string[] {
  const words = String(phrase || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > maxLineChars && lines.length < maxLines - 1) {
      lines.push(cur); cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  // если строк больше лимита — схлопываем хвост в последнюю
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    head.push(lines.slice(maxLines - 1).join(" "));
    return head;
  }
  return lines;
}

const clampDur = (sec: number | undefined): number => {
  const s = Number.isFinite(sec) && (sec as number) > 0 ? (sec as number) : 4;
  return Math.round(Math.max(2, Math.min(8, s)) * FPS);
};

// Главный билдер: вход агента → валидная спека BRoll. idx — порядковый номер клипа (для ротации акцента).
export function buildBRollSpec(input: BRollSpecInput, idx = 0): BRollSpec {
  const preset = input.preset && ["cascade", "quote", "stat"].includes(input.preset)
    ? input.preset : detectPreset(input.phrase);
  const accent = resolveAccent(input.accent, idx);
  const durationInFrames = clampDur(input.durationSec);
  const kicker = input.kicker ? String(input.kicker).slice(0, 24).toUpperCase() : undefined;

  if (preset === "stat") {
    const stat = input.stat && input.stat.value
      ? { value: String(input.stat.value).slice(0, 12), label: String(input.stat.label || "").slice(0, 40) }
      : { value: (String(input.phrase).match(/\d[\d\s.,]*\s?[%₽xхkк]?/i)?.[0] || "100").trim(), label: input.phrase.slice(0, 40) };
    return { durationInFrames, preset, accent, kicker, lines: [String(input.phrase).slice(0, 60)].filter(Boolean), stat };
  }

  if (preset === "quote") {
    const lines = splitToLines(input.phrase, 3, 22);
    return { durationInFrames, preset, accent, kicker, lines };
  }

  // cascade
  const lines = splitToLines(input.phrase, 4, 18);
  const emphasizeIndex = input.emphasizeLast === false ? -1 : Math.max(0, lines.length - 1);
  return { durationInFrames, preset, accent, kicker, lines, emphasizeIndex };
}
