import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { deploymentPinnedUrl } from "../lib/http/deploymentPinnedFetch";

test("deployment pin preserves existing API query parameters", () => {
  assert.equal(
    deploymentPinnedUrl("/api/adverts/list?cabinet=all", "dpl_test123"),
    "/api/adverts/list?cabinet=all&dpl=dpl_test123",
  );
  assert.equal(deploymentPinnedUrl("/api/adverts/list?cabinet=all", ""), "/api/adverts/list?cabinet=all");
});

test("WB adverts pins its custom API request to the client deployment", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../components/wb/WbAdvertsPage.tsx", import.meta.url), "utf8");

  assert.match(config, /NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID:\s*process\.env\.VERCEL_DEPLOYMENT_ID/);
  assert.match(page, /deploymentPinnedFetch\(`\/api\/adverts\/list/);
});

test("WB adverts has a local recovery boundary instead of the global black error page", () => {
  const errorPageUrl = new URL("../app/wb/adverts/error.tsx", import.meta.url);
  assert.equal(existsSync(errorPageUrl), true);

  const errorPage = readFileSync(errorPageUrl, "utf8");
  assert.match(errorPage, /sessionStorage/);
  assert.match(errorPage, /window\.location\.reload\(\)/);
  assert.match(errorPage, /Попробовать снова/);
});
