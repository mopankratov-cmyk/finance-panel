/**
 * Палитра пометок на клетках CTR за день.
 *
 * Смысл цвета задаёт продавец, а не панель: один размечает дни по причине
 * («сменили обложку», «кампания встала»), другой — по тому, разобрался он с
 * днём или нет. Поэтому подписи здесь нейтральные — это названия цветов, а не
 * готовые ярлыки со значением.
 *
 * Классы Tailwind написаны целиком и никогда не собираются из кусков: сборка
 * видит только те имена, которые есть в исходнике буквально, а строка вида
 * `bg-${color}-100` в готовый CSS не попадёт и клетка останется белой.
 *
 * Список закрытый и совпадает с проверкой в базе
 * (202609040007_wb_funnel_ctr_note_color.sql): значение, которого здесь нет,
 * база не примет.
 */
export const CTR_NOTE_COLORS = [
  { key: "violet", label: "Фиолетовый", cell: "bg-violet-200 text-violet-900", swatch: "bg-violet-500" },
  { key: "sky", label: "Синий", cell: "bg-sky-200 text-sky-900", swatch: "bg-sky-500" },
  { key: "cyan", label: "Бирюзовый", cell: "bg-cyan-200 text-cyan-900", swatch: "bg-cyan-500" },
  { key: "emerald", label: "Зелёный", cell: "bg-emerald-200 text-emerald-900", swatch: "bg-emerald-500" },
  { key: "amber", label: "Жёлтый", cell: "bg-amber-200 text-amber-900", swatch: "bg-amber-500" },
  { key: "orange", label: "Оранжевый", cell: "bg-orange-200 text-orange-900", swatch: "bg-orange-500" },
  { key: "rose", label: "Красный", cell: "bg-rose-200 text-rose-900", swatch: "bg-rose-500" },
  { key: "slate", label: "Серый", cell: "bg-slate-300 text-slate-900", swatch: "bg-slate-500" },
] as const;

export type CtrNoteColor = (typeof CTR_NOTE_COLORS)[number]["key"];

const BY_KEY = new Map(CTR_NOTE_COLORS.map((color) => [color.key as string, color]));

/** Пришедшее из запроса или из базы значение — цвет из списка или ничего. */
export function ctrNoteColor(value: unknown): CtrNoteColor | null {
  const key = typeof value === "string" ? value.trim() : "";
  return BY_KEY.has(key) ? (key as CtrNoteColor) : null;
}

/** Классы клетки под цвет пометки. Неизвестный цвет — как будто его нет. */
export function ctrNoteCellClass(value: unknown): string | null {
  const key = ctrNoteColor(value);
  return key ? BY_KEY.get(key)!.cell : null;
}

export function ctrNoteColorLabel(value: unknown): string | null {
  const key = ctrNoteColor(value);
  return key ? BY_KEY.get(key)!.label : null;
}
