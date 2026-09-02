"use client";

import { useEffect, useState } from "react";

export interface CategoryMap {
  categories: string[];
  byArticle: Record<string, string>;
}

const EMPTY: CategoryMap = { categories: [], byArticle: {} };

// Карта одна на вкладку и живёт пять минут.
//
// Пока источник был пуст, ответ весил считанные байты и перезапрос на каждом
// монтировании ничего не стоил. Теперь в карте ~1300 ключей (артикул и
// номенклатура на каждый товар), а экранов, которые её просят, пятнадцать —
// без общего кэша переход между ними перекачивал бы один и тот же список
// заново. Пять минут выбраны по источнику: карточки WB обновляются раз в час,
// ручная категория — по нажатию человека в себестоимости, и увидеть её через
// пять минут (или сразу, обновив вкладку) — приемлемо.
let cached: { at: number; promise: Promise<CategoryMap> } | null = null;
const TTL_MS = 5 * 60 * 1000;

function loadCategoryMap(): Promise<CategoryMap> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.promise;
  const promise = fetch("/api/costs/categories", { cache: "no-store" })
    .then((response) => response.json())
    .then((data: Partial<CategoryMap>) => ({
      categories: data.categories ?? [],
      byArticle: data.byArticle ?? {},
    }))
    .catch(() => {
      // Неудачу не кэшируем: иначе одна сетевая осечка прятала бы фильтр на
      // пять минут во всей панели.
      cached = null;
      return EMPTY;
    });
  cached = { at: now, promise };
  return promise;
}

// Категории товара (ручная product_costs.category, иначе предмет WB) + карта
// ключ→категория — общий источник для фильтра "Все / Куртки / Сумки / ..."
// на WB-аналитика таблицах. Правила приоритета — lib/catalog/productCategories.ts.
export function useCategoryMap(): CategoryMap {
  const [map, setMap] = useState<CategoryMap>(EMPTY);

  useEffect(() => {
    let ignore = false;
    loadCategoryMap().then((loaded) => {
      if (!ignore) setMap(loaded);
    });
    return () => { ignore = true; };
  }, []);

  return map;
}
