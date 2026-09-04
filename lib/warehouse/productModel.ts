// Модель и цвет товара.
//
// Склад по ТЗ показывает иерархию «модель → цвет → размер». У нас товар — это
// уже «модель + цвет» (NV-836-02), размер — вариант. Значит модель нужна как
// группировка над товаром. Источник по решению владельца — карточка WB: цвета
// одной модели у WB объединены общим imtID, цвет лежит в характеристике
// «Цвет». Разбор артикула — запасной путь для товара без карточки. Всё
// правится руками в карточке товара.

export interface ArticleParts {
  model: string;
  color: string | null;
}

/** Хвост артикула, который похож на код цвета: короткий и после разделителя. */
const MAX_COLOR_LENGTH = 24;

/**
 * NV-836-02 → модель NV-836, цвет 02; 673/бежевый → 673 и «бежевый»;
 * «216(150) коричневый» → 216(150) и «коричневый»; ANJ036501 — разделителя
 * нет, вся строка становится моделью. Режем по ПОСЛЕДНЕМУ разделителю: у
 * NV-836-02 их два, и модель — всё до последнего.
 */
export function splitArticle(article: string): ArticleParts {
  const raw = String(article ?? "").trim();
  if (!raw) return { model: "", color: null };
  const match = raw.match(/^(.+?)[-_/ ]+([^-_/ ]+)$/);
  if (!match) return { model: raw, color: null };
  const model = match[1].trim();
  const color = match[2].trim();
  if (model.length < 2 || !color || color.length > MAX_COLOR_LENGTH) return { model: raw, color: null };
  return { model, color };
}

/**
 * Подпись модели для группы карточек с общим imtID: общий префикс артикулов
 * без хвостовых разделителей. NV-836-02, NV-836-04, NV-836-35 → NV-836.
 * У группы из одной карточки общий префикс — она сама, поэтому берём разбор.
 */
export function modelLabelForGroup(articles: string[]): string {
  const list = articles.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return splitArticle(list[0]).model;
  let prefix = list[0];
  for (const article of list.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < article.length && prefix[i].toLowerCase() === article[i].toLowerCase()) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  const trimmed = prefix.replace(/[-_/ ]+$/, "").trim();
  // Слишком короткий общий кусок («N») — не модель, а совпадение первой буквы.
  return trimmed.length >= 2 ? trimmed : splitArticle(list[0]).model;
}

export interface ProductModelSource {
  imtId?: number | null;
  model?: string | null;
  article: string;
}

/** Ключ группировки в остатках: карточка WB важнее подписи, подпись важнее
 *  артикула. Так две карточки с одинаковой подписью «NV-836», но разными
 *  imtID останутся разными моделями — как их видит маркетплейс. */
export function productModelKey(product: ProductModelSource): string {
  if (product.imtId !== null && product.imtId !== undefined && Number.isFinite(Number(product.imtId)) && Number(product.imtId) > 0) {
    return `imt:${Number(product.imtId)}`;
  }
  const model = String(product.model ?? "").trim().toLowerCase();
  if (model) return `model:${model}`;
  return `article:${splitArticle(product.article).model.toLowerCase()}`;
}

/** Подпись модели для экрана: то, что записано, иначе разбор артикула. */
export function productModelLabel(product: ProductModelSource): string {
  const model = String(product.model ?? "").trim();
  return model || splitArticle(product.article).model;
}

/** Подпись цвета: записанный цвет, иначе хвост артикула, иначе пусто. */
export function productColorLabel(product: { color?: string | null; article: string }): string {
  const color = String(product.color ?? "").trim();
  return color || (splitArticle(product.article).color ?? "");
}
