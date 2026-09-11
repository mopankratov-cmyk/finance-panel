"use client";

import { useEffect } from "react";

const NON_FINANCE_MENU_LINKS = [
  "/supplies",
  "/cabinets",
];

/** Скрывает нефинансовые группы общего меню, пока открыта финансовая страница. */
export function FinanceMenuScope() {
  useEffect(() => {
    const hiddenGroups = NON_FINANCE_MENU_LINKS.flatMap((href) => {
      const link = document.querySelector<HTMLAnchorElement>(`aside a[href="${href}"]`);
      const group = link?.closest<HTMLElement>("nav > div");
      if (!group) return [];

      const previousDisplay = group.style.display;
      group.style.display = "none";
      return [{ group, previousDisplay }];
    });

    return () => {
      hiddenGroups.forEach(({ group, previousDisplay }) => {
        group.style.display = previousDisplay;
      });
    };
  }, []);

  return null;
}

/** Оставлено как совместимый вызов для финансовых страниц без верхней навигации. */
export function FinanceTabs() {
  return <FinanceMenuScope />;
}
