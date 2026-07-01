import { connection } from "next/server";

import HeygenBloggerStudio from "./HeygenBloggerStudio";

export const dynamic = "force-dynamic";

export default async function Page() {
  await connection();
  return <HeygenBloggerStudio />;
}
