// Каких карточек кабинета нет в справочнике товаров — и какие из них стоит заводить.
//
// Справочник наполнялся из финансов, а там только позиции с себестоимостью —
// половина ассортимента кабинета в него просто не попала. Заводить их руками по
// одной бессмысленно: у карточки уже есть артикул, название, бренд и номер, а
// единственное, чего она не знает, — цена закупки, и её всё равно вносит человек.
//
// Но тащить в справочник всё подряд тоже нельзя. В кабинете годами висят карточки
// товара, которого давно нет: у CLERIN половина каталога — сумки, заведённые в
// 2023 году и ни разу не заказанные за полгода. Справочник, набитый мёртвыми
// позициями, перестаёт быть рабочим списком.
//
// Поэтому старым молчащим карточкам — отказ, а вот новой карточке без продаж —
// нет: она не мёртвая, она ещё не начала. Возраст решает, что именно означает
// отсутствие заказов.
//
// Совпадение с уже заведённым ищем и по номеру карточки, и по артикулу: товар мог
// быть заведён раньше без nmID (принят до появления карточки) — тогда его
// связывает артикул, и дубль создавать нельзя.

export interface CatalogCard {
  nmId: number;
  article: string;
  brand: string;
  title: string;
  /** Когда карточка заведена в WB. Без даты считаем её старой — молчание такой
   *  карточки объяснить нечем. */
  createdAt: string | null;
}

export interface ExistingProduct {
  nmId: number | null;
  article: string;
}

export interface NewProduct {
  article: string;
  name: string;
  brand: string | null;
  nmId: number;
}

export interface ImportPlan {
  create: NewProduct[];
  /** Старые карточки без заказов за окно — вот их и не заводим. */
  stale: NewProduct[];
}

export interface ImportRules {
  /** Номера карточек, по которым за окном были заказы. */
  soldNmIds: Set<number>;
  /** Начало окна: карточка моложе него — новинка, а не покойник. */
  windowStart: Date;
  /** Завести и молчащие тоже — осознанное решение человека. */
  includeStale?: boolean;
}

const key = (value: string) => value.trim().toLowerCase();

export function planProductImport(
  cards: CatalogCard[],
  existing: ExistingProduct[],
  rules: ImportRules,
): ImportPlan {
  const haveNm = new Set<number>();
  const haveArticle = new Set<string>();
  for (const product of existing) {
    if (product.nmId) haveNm.add(product.nmId);
    const article = key(product.article ?? "");
    if (article) haveArticle.add(article);
  }

  const plan: ImportPlan = { create: [], stale: [] };
  for (const card of cards) {
    const article = String(card.article ?? "").trim();
    // Карточка без артикула в справочник не годится: артикул — ключ товара, по
    // нему сходятся приёмка, себестоимость и коды маркировки.
    if (!article || !Number.isFinite(card.nmId) || card.nmId <= 0) continue;
    if (haveNm.has(card.nmId) || haveArticle.has(key(article))) continue;
    haveNm.add(card.nmId);
    haveArticle.add(key(article));

    const row: NewProduct = {
      article,
      name: String(card.title ?? "").trim() || article,
      brand: String(card.brand ?? "").trim() || null,
      nmId: card.nmId,
    };

    const created = card.createdAt ? Date.parse(card.createdAt) : Number.NaN;
    const isFresh = Number.isFinite(created) && created >= rules.windowStart.getTime();
    if (rules.soldNmIds.has(card.nmId) || isFresh || rules.includeStale) plan.create.push(row);
    else plan.stale.push(row);
  }
  return plan;
}
