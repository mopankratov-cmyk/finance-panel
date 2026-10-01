import { ModelPage } from "@/components/assortment/ModelPage";

export default async function AssortmentJacketsModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModelPage direction="jackets" id={id} />;
}
