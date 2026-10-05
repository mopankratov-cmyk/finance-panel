import { AssortmentSection } from "@/components/assortment/AssortmentSection";
import { catalogFiltersFrom, rejectedFormFrom, sectionViewFrom } from "@/lib/assortment/catalog";

export default async function AssortmentJacketsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = sectionViewFrom(params);
  const filters = catalogFiltersFrom(params, "jackets");
  const rejectedForm = rejectedFormFrom(params, "jackets");
  // Ключ по адресу: переход по меню на чистый адрес раздела сбрасывает вид и фильтры.
  return <AssortmentSection key={`${view}|${JSON.stringify(filters)}|${rejectedForm ?? ""}`} direction="jackets" initialView={view} initialCatalogFilters={filters} rejectedForm={rejectedForm} />;
}
