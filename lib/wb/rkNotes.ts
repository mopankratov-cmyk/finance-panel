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
  /**
   * 'auto' — задачу завёл алгоритм и человек её не трогал; 'human' —
   * последнее слово за человеком. Разница видна на экране: совет и решение
   * не должны выглядеть одинаково, иначе непонятно, с чем спорить.
   */
  source?: "auto" | "human";
  /** Что предлагал алгоритм. Живёт и после правки — иначе не с чем сверять. */
  suggestedNote?: string | null;
  /** Почему предлагал. Показывается при наведении на клетку. */
  suggestedReason?: string | null;
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
export type RkNoteTone = "off" | "round" | "evening" | "budget" | "custom";

export interface RkNotePreset {
  note: string;
  short: string;
  tone: RkNoteTone;
}

/**
 * Набор выведен из рабочей таблицы «Показы CTR CPC», а не придуман: 4 401
 * решение менеджеров за август 2026, 292 разных формулировки.
 *
 * Распределение крайне неровное, и это главное свойство списка. Две верхние
 * формулировки — 56% всех решений, одиннадцать — 73%. Поэтому порядок здесь не
 * алфавитный и не «логический», а по частоте: то, что ставят чаще всего, стоит
 * первым и берётся одним движением.
 *
 * Чего не хватало прежнему списку из шести пунктов (он выражал 30,7% решений):
 *   • «Откл остатки» — 682 раза, 15,5%, вторая по частоте задача вообще. По
 *     смыслу это не «до отгрузки»: там ждут поставку, здесь гасят на распродаже
 *     остатков;
 *   • «Включение в 17:00, отключение в 23:00» — 75 раз. Не то же, что
 *     «17:00–24:00»: час разницы задаётся осознанно;
 *   • «Вкл» и «ЕРК запущена» — короткие отметки состояния, 54 раза вместе;
 *   • бюджет с часом запуска — 1 077 раз, 24,5%. Это не текст, а три параметра,
 *     и для него отдельный сборщик ниже.
 */
export const RK_NOTE_PRESETS: RkNotePreset[] = [
  { note: "Откл до отгрузки", short: "До отгрузки", tone: "off" },
  { note: "Откл остатки", short: "Откл остатки", tone: "off" },
  { note: "Работа с 17:00 - 24:00", short: "17–24", tone: "evening" },
  { note: "Включение в 17:00, отключение в 23:00", short: "17–23", tone: "evening" },
  { note: "Круглосуточно", short: "24 ч", tone: "round" },
  { note: "Работа с 17:00 - 24:00 (ЕРК запущена)", short: "17–24 · ЕРК", tone: "evening" },
  { note: "Круглосуточно (ЕРК запущена)", short: "24 ч · ЕРК", tone: "round" },
  { note: "ЕРК запущена", short: "ЕРК", tone: "round" },
  { note: "Вкл", short: "Вкл", tone: "round" },
  { note: "Откл", short: "Откл", tone: "off" },
];

/**
 * Дневной бюджет с часом запуска — вторая по объёму группа решений (24,5%).
 *
 * В таблице это выглядит свободным текстом («2000 (запуск 17:00)», «3000
 * запуск только полок срм», «4000 (запуск 17:00) бидер»), но на деле здесь три
 * параметра: сумма, площадка и работает ли биддер. Десять самых частых
 * сочетаний покрывают 61% группы, а суммы повторяются одни и те же.
 *
 * Поэтому не двадцать пунктов в списке, а сборщик: сумма × площадка × биддер.
 */
export const RK_BUDGET_AMOUNTS = [1_500, 2_000, 2_500, 3_000, 4_000] as const;

export type RkBudgetPlacement = "all" | "shelf_cpm";

export interface RkBudgetTask {
  amountRub: number;
  placement: RkBudgetPlacement;
  /** Ставкой управляет внешний биддер — в таблице это приписка «бидер». */
  bidder: boolean;
}

/**
 * Текст задачи с бюджетом. Один вид записи на всех — иначе разбор рассыпется.
 *
 * Пробел в разряде обычный, а не неразрывный: `toLocaleString` отдаёт U+00A0,
 * и такой текст уходит в базу ключом, по которому потом ищут и сравнивают.
 * Невидимый символ в ключе — источник расхождений, которых не видно глазами.
 */
export function rkBudgetNote(task: RkBudgetTask): string {
  const amount = task.amountRub.toLocaleString("ru-RU").replace(/\u00a0/g, " ");
  const where = task.placement === "shelf_cpm" ? "только полки CPM" : "запуск 17:00";
  return `${amount} ₽, ${where}${task.bidder ? ", биддер" : ""}`;
}

/** Короткая форма для клетки: сумма и главное отличие. */
export function rkBudgetShort(task: RkBudgetTask): string {
  const amount = task.amountRub >= 1_000
    ? `${Math.round(task.amountRub / 100) / 10}к`.replace(".", ",")
    : String(task.amountRub);
  return `${amount} ${task.placement === "shelf_cpm" ? "полки" : "17:00"}${task.bidder ? " · бид" : ""}`;
}

/** Задача с бюджетом? По ней клетка красится своим цветом. */
const BUDGET_RE = /^\s*[\d\s ]{3,7}₽,\s/;

/** Сравниваем без пробелов и регистра: «Круглосуточно(ЕРК запущена)» — та же задача. */
const canonical = (note: string) => note.toLowerCase().replace(/\s+/g, "");

const BY_TEXT = new Map(RK_NOTE_PRESETS.map((preset) => [canonical(preset.note), preset]));

/** Как задача выглядит в клетке. Своя формулировка показывается как есть. */
export function rkNoteShort(note: string): string {
  const known = BY_TEXT.get(canonical(note))?.short;
  if (known) return known;
  // «2 000 ₽, только полки CPM, биддер» в клетку не влезет даже в две строки.
  const budget = note.match(/^\s*([\d\s ]{3,7})₽,\s*(.+)$/);
  if (budget) {
    const amount = Number(budget[1].replace(/[^\d]/g, ""));
    const rest = budget[2];
    return rkBudgetShort({
      amountRub: Number.isFinite(amount) ? amount : 0,
      placement: /полки/i.test(rest) ? "shelf_cpm" : "all",
      bidder: /биддер/i.test(rest),
    });
  }
  return note;
}

/** Смысловая группа задачи — по ней клетка окрашивается. */
export function rkNoteTone(note: string): RkNoteTone {
  const known = BY_TEXT.get(canonical(note))?.tone;
  if (known) return known;
  // Задачи с бюджетом собираются на лету, и в словаре пресетов их нет.
  return BUDGET_RE.test(note) ? "budget" : "custom";
}
