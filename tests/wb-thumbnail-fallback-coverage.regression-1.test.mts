import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const WB_THUMBNAIL_FILES = [
  "app/adverts/page.tsx",
  "app/rnp/page.tsx",
  "app/seo/page.tsx",
  "app/sklejki/page.tsx",
  "app/unit/page.tsx",
  "components/reviews/ReviewCard.tsx",
  "components/supplies/ReceivingTab.tsx",
  "components/supplies/StockCatalogTab.tsx",
  "components/wb/WbAbcPage.tsx",
  "components/wb/WbAdvertsPage.tsx",
  "components/wb/WbFunnelPage.tsx",
  "components/wb/WbProductPage.tsx",
  "components/wb/WbReviewsPage.tsx",
  "components/wb/WbRnpPage.tsx",
  "components/wb/WbSeoPage.tsx",
  "components/wb/WbSklejkiPage.tsx",
  "components/wb/WbUnitPage.tsx",
];

test("WB product thumbnail screens use a fallback image component instead of hiding broken images", () => {
  for (const file of WB_THUMBNAIL_FILES) {
    const source = readFileSync(file, "utf8");

    assert.doesNotMatch(source, /style\.visibility\s*=\s*"hidden"|style\.display\s*=\s*"none"|setBroken\(true\)/, file);
    assert.match(source, /WbProductImage/, file);
  }
});
