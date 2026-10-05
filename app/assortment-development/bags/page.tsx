import { AssortmentSection } from "@/components/assortment/AssortmentSection";
import { catalogFiltersFrom, rejectedFormFrom, sectionViewFrom } from "@/lib/assortment/catalog";

export default async function AssortmentBagsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = sectionViewFrom(params);
  const filters = catalogFiltersFrom(params, "bags");
  const rejectedForm = rejectedFormFrom(params, "bags");
  // Ключ по адресу: переход по меню на чистый адрес раздела сбрасывает вид и фильтры.
  return <AssortmentSection key={`${view}|${JSON.stringify(filters)}|${rejectedForm ?? ""}`} direction="bags" initialView={view} initialCatalogFilters={filters} rejectedForm={rejectedForm} />;
}
