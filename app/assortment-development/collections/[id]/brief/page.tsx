import { BriefPage } from "@/components/assortment/BriefPage";

export default async function AssortmentBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  const parsed = Number(version);
  return <BriefPage id={id} version={Number.isInteger(parsed) && parsed > 0 ? parsed : null} />;
}
