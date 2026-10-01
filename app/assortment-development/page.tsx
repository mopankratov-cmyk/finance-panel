"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ASSORTMENT_BASE_PATH, ASSORTMENT_LAST_SECTION_KEY, parseDirection } from "@/lib/assortment/constants";

/** Корень модуля открывает последний выбранный раздел, по умолчанию «Куртки» (ТЗ §1). */
export default function AssortmentDevelopmentRoot() {
  const router = useRouter();
  useEffect(() => {
    let last: string | null = null;
    try {
      last = window.localStorage.getItem(ASSORTMENT_LAST_SECTION_KEY);
    } catch {
      // Хранилище недоступно (приватный режим) — открываем раздел по умолчанию.
    }
    router.replace(`${ASSORTMENT_BASE_PATH}/${parseDirection(last) ?? "jackets"}`);
  }, [router]);
  return <div className="p-6 text-sm text-slate-500">Открываем раздел…</div>;
}
