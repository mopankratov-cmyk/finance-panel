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
