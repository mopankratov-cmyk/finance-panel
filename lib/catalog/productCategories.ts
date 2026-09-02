/**
 * Категория товара для фильтра «Все / Куртки / Сумки / …».
 *
 * Поле `product_costs.category` существует с 07.2026 и заполнено у 0 строк из
 * 215. Это не небрежность: заполняется оно поштучно в таблице себестоимости
 * (`app/costs/page.tsx`), а руками двести с лишним артикулов не заводит никто.
 * Из-за пустого источника `CategoryFilter` прятал себя на всех экранах —
 * фильтр был в коде, но не существовал для человека.
 *
 * При этом категория товара в панели УЖЕ есть и заполнена целиком: предмет WB
 * (`wb_cards.subject`, 668 карточек из 668). По нему проект уже группирует
 * планирование, склейки, сезонность и сверку ЧЗ, и владелец уже принимает по
 * нему решения руками — в настройках сверки КИЗ прячут именно предмет, а не
 * артикул, потому что «продавец мыслит категориями».
 *
 * Отсюда правило приоритета: рука бьёт автомат. Что человек вписал в
 * себестоимости — то и категория. Не вписал — берём предмет WB. Нет ни того,
 * ни другого — категории нет, и строка честно уходит в «Остальное», а не
 * получает выдуманную.
 *
 * Чего здесь намеренно НЕТ — словаря групп («Куртки+Ветровки+Пальто → верхняя
 * одежда»). Он выглядит полезным, пока не посчитаешь: сейчас самая крупная
 * кнопка «Куртки» — это 43% каталога, после схлопывания «Верхняя одежда» стала
 * бы 62%, то есть кнопка, которая почти ничего не отсеивает. К тому же куртки и
 * ветровки в этом проекте — разные сущности с разной сезонностью. Схлопывание
 * остаётся доступным владельцу через ручную категорию; навязывать своё
 * товароведение из `lib/` мы не будем.
 */

export interface CategoryCardRow {
  article: string | null;
  nm_id: number | null;
  subject: string | null;
}

export interface CategoryCostRow {
  article: string | null;
  category: string | null;
}

export interface ProductCategoryMap {
  /** Категории по убыванию числа товаров: полезные — первыми, хвост достижим. */
  categories: string[];
  /** Ключ → категория. Ключей у одного товара два: артикул и nm_id строкой. */
  byArticle: Record<string, string>;
}

const clean = (value: unknown): string => String(value ?? "").trim();

/**
 * Собирает карту «ключ → категория».
 *
 * Ключей у товара два, и второй важнее, чем кажется. Девять роутов отдают
 * артикул как `article || String(nm_id)` — то есть у товара с пустым
 * vendorCode ключом строки становится номер номенклатуры. Раньше такие товары
 * не находились в карте никогда и молча оседали в «Остальное».
 *
 * Неоднозначность разрешается умолчанием, а не догадкой: если под одним
 * артикулом лежат карточки с РАЗНЫМИ предметами, артикульный ключ по предмету
 * не выдаётся вовсе (nm-ключи выдаются — они однозначны по построению).
 * Тот же приём проект уже применяет, связывая товар с карточкой только при
 * единственной номенклатуре. Ручная категория неоднозначной не бывает: её
 * писал человек про артикул, поэтому она проставляется и при расхождении.
 */
export function resolveProductCategories(
  cards: CategoryCardRow[],
  costs: CategoryCostRow[],
): ProductCategoryMap {
  const subjectsByArticle = new Map<string, Set<string>>();
  const nmsByArticle = new Map<string, string[]>();

  for (const card of cards) {
    const article = clean(card.article);
    if (!article) continue;
    const subject = clean(card.subject);
    if (subject) {
      const known = subjectsByArticle.get(article) ?? new Set<string>();
      known.add(subject);
      subjectsByArticle.set(article, known);
    }
    const nm = clean(card.nm_id);
    if (nm) nmsByArticle.set(article, [...(nmsByArticle.get(article) ?? []), nm]);
  }

  const byArticle: Record<string, string> = {};
  // Категория ТОВАРА, а не ключа: товар — это артикул, если он есть, иначе
  // номенклатура. Считать по ключам нельзя, у товара их обычно два.
  const byProduct = new Map<string, string>();

  // Слой 1 — предмет WB.
  for (const card of cards) {
    const subject = clean(card.subject);
    if (!subject) continue;
    const nm = clean(card.nm_id);
    const article = clean(card.article);
    if (nm) byArticle[nm] = subject;
    if (article && subjectsByArticle.get(article)?.size === 1) {
      byArticle[article] = subject;
      byProduct.set(article, subject);
    } else if (!article && nm) {
      byProduct.set(nm, subject);
    }
  }

  // Слой 2 — рука. Пишется поверх предмета и по ВСЕМ ключам этого артикула:
  // иначе один товар попадал бы в разные кнопки на разных экранах, смотря чем
  // конкретная таблица ключуется.
  for (const cost of costs) {
    const article = clean(cost.article);
    const category = clean(cost.category);
    if (!article || !category) continue;
    byArticle[article] = category;
    byProduct.set(article, category);
    for (const nm of nmsByArticle.get(article) ?? []) byArticle[nm] = category;
  }

  const weight = new Map<string, number>();
  for (const category of byProduct.values()) weight.set(category, (weight.get(category) ?? 0) + 1);

  const categories = [...weight.keys()].sort((left, right) => {
    const diff = (weight.get(right) ?? 0) - (weight.get(left) ?? 0);
    return diff !== 0 ? diff : left.localeCompare(right, "ru");
  });

  return { categories, byArticle };
}
