import { redirect } from "next/navigation";

export default async function RepricerRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  params.set("view", "repricer");
  const cabinet = incoming.cabinet;
  if (typeof cabinet === "string" && cabinet) params.set("cabinet", cabinet);
  redirect(`/wb/funnel?${params.toString()}`);
}
