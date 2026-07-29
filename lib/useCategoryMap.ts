"use client";

import { useEffect, useState } from "react";

// Категории товара (product_costs.category) + карта article→category — общий
// источник для фильтра "Все / Ковры / Сумки / ..." на WB-аналитика таблицах.
export function useCategoryMap(): { categories: string[]; byArticle: Record<string, string> } {
  const [categories, setCategories] = useState<string[]>([]);
  const [byArticle, setByArticle] = useState<Record<string, string>>({});

  useEffect(() => {
    let ignore = false;
    fetch("/api/costs/categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { categories?: string[]; byArticle?: Record<string, string> }) => {
        if (ignore) return;
        setCategories(d.categories ?? []);
        setByArticle(d.byArticle ?? {});
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, []);

  return { categories, byArticle };
}
