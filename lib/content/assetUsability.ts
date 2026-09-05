/**
 * Что можно сделать с файлом контента — и чего нельзя.
 *
 * Каталог съёмок собирался контент-заводом и хранит «ссылку» в поле `url`, но
 * ссылки там четырёх разных сортов, и только два из них — настоящие адреса.
 * Замер по всем 9 069 строкам на 05.09.2026:
 *
 *   3 875  https://basket-NN.wbbasket.ru/…      — фото карточек WB, публичные
 *     219  …supabase.co/storage/v1/object/public — наш бакет, публичный
 *   2 377  /api/lab/yandex-img?path=…            — роут ЭТОЙ панели, прокси Диска
 *   2 577  yandex-disk:/content-factory/…        — путь на Диске, а не адрес
 *      21  пусто или прочее
 *
 * Разница между третьим и первыми двумя не косметическая. Вариант CTR-теста
 * уходит НАРУЖУ: его должен скачать WB. Относительный путь `/api/…` наружу не
 * существует, а `yandex-disk:` не откроет и браузер. Показать в панели прокси
 * ещё можно — отдать в тест нельзя.
 *
 * Поэтому пригодность разведена на две: `canPreview` (видно в панели) и
 * `canPublish` (можно отдать наружу). Библиотека показывает и то и другое, но
 * в выбор для теста пускает только второе, и говорит почему — иначе человек
 * выберет твин, тест не запустится, и виноватой будет выглядеть панель.
 */

export type AssetUsability =
  /** Публичный https: видно в панели, можно отдать в тест. */
  | "public"
  /** Прокси-роут панели: видно здесь, наружу не отдать. */
  | "panel-only"
  /** Путь на Диске вместо адреса: показать нечем, пока файл не переложен. */
  | "unresolved"
  /** Ссылки нет вовсе. */
  | "missing";

const PUBLIC_STORAGE_MARK = "supabase.co/storage/v1/object/public/";

export function assetUsability(url: string | null | undefined): AssetUsability {
  const value = String(url ?? "").trim();
  if (!value) return "missing";
  if (value.startsWith("yandex-disk:")) return "unresolved";
  if (value.startsWith("/")) return "panel-only";
  if (!value.startsWith("https://")) return "unresolved";
  // Публичным считаем то, что открывается без нашей сессии и без нашего домена:
  // баскет WB и публичный бакет. Прочий https может быть чем угодно, вплоть до
  // ссылки с истекающей подписью, — обещать за него «можно в тест» не за что.
  if (value.startsWith("https://basket-")) return "public";
  if (value.includes(PUBLIC_STORAGE_MARK)) return "public";
  return "panel-only";
}

export const USABILITY_LABEL: Record<AssetUsability, string> = {
  public: "можно в тест",
  "panel-only": "только просмотр",
  unresolved: "файл недоступен",
  missing: "нет ссылки",
};

export const USABILITY_HINT: Record<AssetUsability, string> = {
  public: "Публичная ссылка: WB скачает такой файл сам.",
  "panel-only": "Файл открывается через прокси панели. В тест его отдать нельзя — WB до него не достучится.",
  unresolved: "В каталоге записан путь на Яндекс.Диске, а не адрес. Чтобы файл стал доступен, его нужно переложить в наше хранилище.",
  missing: "У записи каталога нет ссылки на файл.",
};

export function canPublishAsset(url: string | null | undefined): boolean {
  return assetUsability(url) === "public";
}

export function canPreviewAsset(url: string | null | undefined): boolean {
  const usability = assetUsability(url);
  return usability === "public" || usability === "panel-only";
}

/** Публичный бакет и префикс, куда панель кладёт загруженные человеком фото. */
export const PANEL_UPLOAD_BUCKET = "factory-media";
export const PANEL_UPLOAD_PREFIX = "panel-uploads";

/**
 * Наша ли это загрузка.
 *
 * Удалять из панели можно только то, что она сама и положила: кадры карточки
 * живут в WB, съёмки — в каталоге завода, и «удалить» в интерфейсе должно
 * означать одно и то же везде, а не «иногда уберёт, иногда откажет».
 */
export function isPanelUpload(url: string | null | undefined): boolean {
  return String(url ?? "").includes(
    `/storage/v1/object/public/${PANEL_UPLOAD_BUCKET}/${PANEL_UPLOAD_PREFIX}/`,
  );
}

/**
 * Готовые обложки, залитые в наш бакет из наработок дизайна.
 *
 * Лежат по `covers/<артикул>/…` — без кабинета в пути, в отличие от загрузок с
 * экрана. Поэтому и проверка принадлежности у них другая: не по пути, а по
 * товару (см. роут удаления).
 */
export const PANEL_COVER_PREFIX = "covers";

export function isPanelCover(url: string | null | undefined): boolean {
  return String(url ?? "").includes(
    `/storage/v1/object/public/${PANEL_UPLOAD_BUCKET}/${PANEL_COVER_PREFIX}/`,
  );
}

/**
 * Файл, которым распоряжается панель, — то есть его можно удалить отсюда.
 *
 * Это НЕ «всё, что лежит в нашем бакете»: там же живут `gen/` и `prepared/`
 * контент-завода, у которого свой репозиторий и свои ссылки на эти файлы.
 * Снести их отсюда значило бы сломать соседа молча. Панели принадлежат две
 * папки: загрузки с экрана и обложки.
 *
 * Кадры карточки живут в WB, съёмки — в каталоге на Яндекс.Диске; ни то ни
 * другое панель не удаляет и предлагать не должна.
 */
export function isPanelOwned(url: string | null | undefined): boolean {
  return isPanelUpload(url) || isPanelCover(url);
}
