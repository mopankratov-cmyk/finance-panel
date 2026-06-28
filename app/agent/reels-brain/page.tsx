import { connection } from "next/server";

import ReelsBrainConsole from "./ReelsBrainConsole";

export default async function Page() {
  await connection();
  return <ReelsBrainConsole />;
}
