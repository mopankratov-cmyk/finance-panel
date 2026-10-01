import { ComparePage } from "@/components/assortment/ComparePage";

export default async function AssortmentBagsComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  return <ComparePage direction="bags" ids={(ids ?? "").split(",").filter(Boolean).slice(0, 6)} />;
}
