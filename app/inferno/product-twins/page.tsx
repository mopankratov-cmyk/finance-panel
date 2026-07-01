import { connection } from "next/server";

import ProductTwinStudio from "./ProductTwinStudio";

export const dynamic = "force-dynamic";

export default async function Page() {
  await connection();
  return <ProductTwinStudio />;
}
