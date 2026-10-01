import { CollectionEditor } from "@/components/assortment/CollectionEditor";

export default async function AssortmentCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CollectionEditor id={id} />;
}
