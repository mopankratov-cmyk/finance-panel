/**
 * Заметки менеджеру в журнале РК — общая форма для экрана и роута.
 *
 * Живёт отдельно от роута намеренно: роут тянет серверную авторизацию, и
 * импорт из него в клиентский компонент утаскивает next/headers в браузерную
 * сборку. Тип можно было бы забрать через `import type`, а функцию — нет.
 */
export interface RkNote {
  nmId: number;
  /** null — заметка про товар целиком, иначе про конкретную кампанию. */
  advertId: number | null;
  date: string;
  note: string;
  done: boolean;
  updatedAt: string | null;
}

/** Ключ клетки: артикул, кампания (или «-» для товара целиком), дата. */
export const rkNoteKey = (nmId: number, advertId: number | null, date: string) =>
  `${nmId}|${advertId ?? "-"}|${date}`;

/**
 * Повторяющиеся задачи в журнале РК.
 *
 * Менеджер пишет одно и то же изо дня в день: выключить кампанию, включить на
 * вечер, оставить круглосуточно. Печатать это руками в каждой клетке — работа
 * ради работы, поэтому список натыкивается в один клик.
 *
 * `short` — то, что помещается в клетку: содержимое задачи должно читаться на
 * листе, без захода внутрь. `tone` — смысловая группа, а не украшение:
 * выключено, круглосуточно, вечерний режим.
 */
export type RkNoteTone = "off" | "round" | "evening" | "custom";

export interface RkNotePreset {
  note: string;
  short: string;
  tone: RkNoteTone;
}

export const RK_NOTE_PRESETS: RkNotePreset[] = [
  { note: "Откл", short: "Откл", tone: "off" },
  { note: "Откл до отгрузки", short: "До отгрузки", tone: "off" },
  { note: "Круглосуточно", short: "24 ч", tone: "round" },
  { note: "Круглосуточно (ЕРК запущена)", short: "24 ч · ЕРК", tone: "round" },
  { note: "Работа с 17:00 - 24:00", short: "17–24", tone: "evening" },
  { note: "Работа с 17:00 - 24:00 (ЕРК запущена)", short: "17–24 · ЕРК", tone: "evening" },
];

/** Сравниваем без пробелов и регистра: «Круглосуточно(ЕРК запущена)» — та же задача. */
const canonical = (note: string) => note.toLowerCase().replace(/\s+/g, "");

const BY_TEXT = new Map(RK_NOTE_PRESETS.map((preset) => [canonical(preset.note), preset]));

/** Как задача выглядит в клетке. Своя формулировка показывается как есть. */
export function rkNoteShort(note: string): string {
  return BY_TEXT.get(canonical(note))?.short ?? note;
}

/** Смысловая группа задачи — по ней клетка окрашивается. */
export function rkNoteTone(note: string): RkNoteTone {
  return BY_TEXT.get(canonical(note))?.tone ?? "custom";
}
