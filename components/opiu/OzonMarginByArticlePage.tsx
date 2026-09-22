"use client";

import { Sigma } from "lucide-react";

export function OzonMarginByArticlePage() {
  return (
    <div className="bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
            <Sigma className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight">Маржа по артикулам (артикул Ozon)</h1>
            <p className="text-xs text-gray-500">По факту финотчёта Ozon, сгруппировано по артикулу</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[110rem] px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Раздел в разработке: следующий шаг — подгрузка данных по кабинетам Ozon.
        </div>
      </div>
    </div>
  );
}
