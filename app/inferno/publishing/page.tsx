import type { Metadata } from "next";
import { connection } from "next/server";
import PublishingCockpit from "./PublishingCockpit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Publication Cockpit — Inferno",
  description: "Пульт выкладки контента: очередь, календарь, флот аккаунтов, live posting и метрики.",
};

export default async function Page() {
  await connection();
  return <PublishingCockpit />;
}
