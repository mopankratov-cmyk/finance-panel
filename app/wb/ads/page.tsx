import { redirect } from "next/navigation";

/**
 * «Управление рекламой» переехало внутрь «Рекламы» отдельными разделами.
 *
 * Страница остаётся редиректом, а не удаляется: на неё есть закладки и ссылки
 * из прошлых обсуждений, а 404 вместо переезда выглядит как поломка панели.
 * Кабинет переносим — без него объединённый модуль откроется не там, где человек
 * был, и он решит, что данные пропали.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ cabinet?: string }> }) {
  const { cabinet } = await searchParams;
  redirect(cabinet ? `/wb/adverts?cabinet=${encodeURIComponent(cabinet)}` : "/wb/adverts");
}
