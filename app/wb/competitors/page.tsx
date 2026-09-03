import { WbCompetitorsPage } from "@/components/wb/WbCompetitorsPage";
import { WbShell } from "@/components/wb/WbShell";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <WbShell>
      <WbCompetitorsPage />
    </WbShell>
  );
}
