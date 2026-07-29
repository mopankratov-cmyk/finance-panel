"use client";

// Тулбар "Все / <категория1> / <категория2> / Остальное" — как в infernoff.ru.
// "Остальное" = SKU без заведённой категории. Скрывается сам, если категорий нет вовсе.
export function CategoryFilter({ categories, value, onChange, hasUncategorized = true }: {
  categories: string[]; value: string; onChange: (v: string) => void; hasUncategorized?: boolean;
}) {
  if (categories.length === 0) return null;
  const options = ["", ...categories, ...(hasUncategorized ? ["__none"] : [])];
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
