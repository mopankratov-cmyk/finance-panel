import { ComparePage } from "@/components/assortment/ComparePage";

export default async function AssortmentJacketsComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  return <ComparePage direction="jackets" ids={(ids ?? "").split(",").filter(Boolean).slice(0, 6)} />;
}
