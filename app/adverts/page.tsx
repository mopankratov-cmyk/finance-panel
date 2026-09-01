import { redirect } from "next/navigation";

/**
 * Старый экран рекламы. Всё, что он показывал и чего не было на новых —
 * расход вчера с процентом, баланс продвижения с порогом и фильтр по
 * категориям товара, — перенесено в объединённый модуль «Реклама».
 *
 * Редирект, а не удаление файла: путь /adverts прописан в правах ролей
 * (lib/auth/roles.ts), то есть закладка у финансиста и менеджера живая.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ cabinet?: string }> }) {
  const { cabinet } = await searchParams;
  redirect(cabinet ? `/wb/adverts?cabinet=${encodeURIComponent(cabinet)}` : "/wb/adverts");
}
