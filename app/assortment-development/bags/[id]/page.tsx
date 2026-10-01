import { ModelPage } from "@/components/assortment/ModelPage";

export default async function AssortmentBagsModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelPage direction="bags" id={id} />;
}
