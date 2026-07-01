import { connection } from "next/server";

import ReelsBrainPixelCockpit from "./ReelsBrainPixelCockpit";

export default async function Page() {
  await connection();
  return <ReelsBrainPixelCockpit />;
}
