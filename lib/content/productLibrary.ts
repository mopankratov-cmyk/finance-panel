import { assetUsability, type AssetUsability } from "@/lib/content/assetUsability";

/**
 * Контент товара, собранный из двух источников, которые до сих пор не
 * встречались друг с другом.
 *
 * Первый — галерея карточки WB. Обход Content API её приносит, а до миграции
 * 202609050001 запись в `wb_cards` её выбрасывала: панель знала по товару одну
 * картинку — обложку, вычисленную из nm_id по таблице баскетов.
 *
 * Второй — каталог съёмок `content_assets`: 9 069 файлов, которые наполнял
 * контент-завод. Завод уехал в отдельный репозиторий, и в этой панели каталог
 * не читал никто.
 *
 * Привязка к товару РАЗРЕШАЕТСЯ НА ЧТЕНИИ, а не чинится записью. Так же
 * устроен справочник категорий: чинить 9 тысяч строк UPDATE'ом значит принять
 * сегодняшнюю догадку за факт и потерять исходник. Здесь исходник — колонка
 * `article`, заполненная best-effort, и она остаётся как есть.
 */

export interface LibraryCardRow {
  nm_id: number;
  article: string | null;
  name: string | null;
  subject: string | null;
  photos?: unknown;
  photos_big?: unknown;
  photos_count?: number | null;
}

export interface LibraryAssetRow {
  id: number;
  article: string | null;
  kind: string | null;
  url: string | null;
  name: string | null;
  disk: string | null;
  niche: string | null;
}

export type ContentOrigin = "card" | "shoot";

export interface ContentItem {
  /** Устойчивый ключ для выбора мышкой: пережил перезагрузку списка. */
  key: string;
  url: string;
  /** Миниатюра, если источник даёт отдельную; иначе тот же url. */
  thumbUrl: string;
  kind: "image" | "video";
  origin: ContentOrigin;
  usability: AssetUsability;
  label: string;
  /** Обложка карточки — первый кадр галереи WB. */
  isCover: boolean;
}

export interface ProductContent {
  nmId: number;
  article: string;
  name: string;
  subject: string;
  items: ContentItem[];
  /** Сколько из них можно отдать в тест. Считается здесь, чтобы экран не считал. */
  publishableCount: number;
  /**
   * Галерея карточки в базе отсутствует — не пуста, а не записана.
   * Экран должен сказать «карточка ещё не обойдена», а не «фото нет».
   */
  galleryUnknown: boolean;
}

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
};

const normalizeArticle = (value: unknown): string => String(value ?? "").trim();

export function buildProductContent(
  cards: LibraryCardRow[],
  assets: LibraryAssetRow[],
): ProductContent[] {
  const assetsByArticle = new Map<string, LibraryAssetRow[]>();
  for (const asset of assets) {
    const article = normalizeArticle(asset.article);
    if (!article) continue;
    const list = assetsByArticle.get(article) ?? [];
    list.push(asset);
    assetsByArticle.set(article, list);
  }

  const products: ProductContent[] = [];
  for (const card of cards) {
    const nmId = Number(card.nm_id);
    if (!Number.isFinite(nmId)) continue;
    const article = normalizeArticle(card.article) || String(nmId);

    const thumbs = asStringArray(card.photos);
    const bigs = asStringArray(card.photos_big);
    // Галерея не записана — это не «фото нет». Отличаем отсутствие колонки от
    // пустого списка: у карточки без фото массив пуст, у необойдённой его нет.
    const galleryUnknown = card.photos == null && card.photos_big == null;

    const items: ContentItem[] = [];
    const gallery = bigs.length ? bigs : thumbs;
    gallery.forEach((url, index) => {
      items.push({
        key: `card:${nmId}:${index}`,
        url,
        thumbUrl: thumbs[index] || url,
        kind: "image",
        origin: "card",
        usability: assetUsability(url),
        label: index === 0 ? "Обложка карточки" : `Кадр карточки ${index + 1}`,
        isCover: index === 0,
      });
    });

    for (const asset of assetsByArticle.get(article) ?? []) {
      const url = String(asset.url ?? "");
      items.push({
        key: `shoot:${asset.id}`,
        url,
        thumbUrl: url,
        kind: asset.kind === "video" ? "video" : "image",
        origin: "shoot",
        usability: assetUsability(url),
        label: String(asset.name ?? "").trim() || String(asset.disk ?? "съёмка"),
        isCover: false,
      });
    }

    // Сначала то, что можно пустить в дело: обложка, потом остальные публичные,
    // потом просмотр-только, потом недоступное. Человек ищет глазами сверху,
    // и первым ему должно попадаться пригодное, а не мусор каталога.
    const rank = (item: ContentItem) =>
      item.isCover ? 0
        : item.usability === "public" ? 1
          : item.usability === "panel-only" ? 2 : 3;
    items.sort((left, right) => rank(left) - rank(right));

    products.push({
      nmId,
      article,
      name: String(card.name ?? "").trim(),
      subject: String(card.subject ?? "").trim(),
      items,
      publishableCount: items.filter((item) => item.usability === "public").length,
      galleryUnknown,
    });
  }

  return products;
}

/**
 * Файлы каталога, которые не приросли ни к одному товару.
 *
 * Их 1 442 без артикула плюс те, чей артикул не встретился среди карточек.
 * Прятать их нельзя: это не пустое место, а работа, которую кто-то сделал и
 * которая сейчас недоступна. Экран показывает их числом со ссылкой «показать»,
 * чтобы разобрать руками.
 */
export function countOrphanAssets(cards: LibraryCardRow[], assets: LibraryAssetRow[]): number {
  const known = new Set(cards.map((card) => normalizeArticle(card.article)).filter(Boolean));
  let orphans = 0;
  for (const asset of assets) {
    const article = normalizeArticle(asset.article);
    if (!article || !known.has(article)) orphans += 1;
  }
  return orphans;
}
