"use client";

// Тулбар "Все / <категория1> / <категория2> / Остальное" — как в infernoff.ru.
// "Остальное" = SKU без заведённой категории. Скрывается сам, если категорий нет вовсе.
//
// Кнопки приходят уже отсортированными по числу товаров (см.
// lib/catalog/productCategories.ts): крупные категории первыми, хвост
// достижим переносом строки.
export function CategoryFilter({ categories, value, onChange, hasUncategorized = true }: {
  categories: string[]; value: string; onChange: (v: string) => void; hasUncategorized?: boolean;
}) {
  if (categories.length === 0) return null;
  // Выбранная категория остаётся кнопкой, даже если на экране её больше нет:
  // сменили кабинет — и «Куртки» исчезли бы из списка, оставив пустую таблицу
  // и ни одной подсвеченной кнопки, то есть отфильтрованный экран без видимой
  // причины и без способа снять фильтр.
  const missing = value && value !== "__none" && !categories.includes(value) ? [value] : [];
  const options = ["", ...categories, ...missing, ...(hasUncategorized ? ["__none"] : [])];
  const label = (o: string) => (o === "" ? "Все" : o === "__none" ? "Остальное" : o);
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-gray-100 p-0.5">
      {options.map((o) => (
        <button
          key={o || "all"}
          onClick={() => onChange(o)}
          className={`rounded px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${value === o ? "bg-white text-violet-700 shadow" : "text-gray-500"}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

// Применяет выбранную категорию к списку строк с полем-артикулом (client-side —
// категории живут в product_costs, а не в самих WB-таблицах, поэтому фильтруем
// уже загруженные данные, не трогая 9 разных API-контрактов).
export function filterByCategory<T>(rows: T[], articleOf: (r: T) => string, byArticle: Record<string, string>, value: string): T[] {
  if (!value) return rows;
  if (value === "__none") return rows.filter((r) => !byArticle[articleOf(r)]);
  return rows.filter((r) => byArticle[articleOf(r)] === value);
}

/**
 * Кнопки, которые на ЭТОМ экране действительно что-то отфильтруют.
 *
 * Карта категорий общая для всей панели: в ней и куртки, и пудры, и игрушечное
 * оружие. Экран же показывает один кабинет и один период. Без этого отбора
 * тулбар склеек с ветровками показывал бы «Пудры» — кнопку, которая всегда
 * отфильтровывает в ноль. Приём не новый: ровно так уже устроен РНП
 * (`lib/rnp/productFacets.ts`), здесь он просто становится общим.
 *
 * Порядок кнопок берётся из `all` — он частотный и приходит с сервера; здесь
 * мы только выкидываем лишние, но не пересортировываем.
 *
 * `hasUncategorized` считается тем же проходом: «Остальное» без единой строки
 * без категории — такая же пустая кнопка, как «Пудры» на экране с куртками.
 */
export function categoriesOnScreen<T>(
  rows: T[],
  articleOf: (r: T) => string,
  byArticle: Record<string, string>,
  all: string[],
): { categories: string[]; hasUncategorized: boolean } {
  const present = new Set<string>();
  let hasUncategorized = false;
  for (const row of rows) {
    const category = byArticle[articleOf(row)];
    if (category) present.add(category);
    else hasUncategorized = true;
  }
  return { categories: all.filter((category) => present.has(category)), hasUncategorized };
}
