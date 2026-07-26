import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sales-plan API requires a real session and never treats missing session as elevated", () => {
  const source = readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");

  assert.match(source, /const session = await getServerSession\(\);[\s\S]*?if \(!session\) return \{ error: "Не авторизовано", status: 401 \} as const;/);
  assert.doesNotMatch(source, /!session\s*\|\|[\s\S]{0,80}session\.role === "director"/);
  assert.match(source, /const elevated = canModerateSalesPlan\(resolved\.session\);/);
});

test("sales-plan API rejects unknown actions instead of saving them as drafts", () => {
  const source = readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");

  assert.match(source, /const action = normalizeSalesPlanAction\(body\.action\);/);
  assert.match(source, /if \(!action\) return NextResponse\.json\(\{ error: "Неизвестное действие плана" \}, \{ status: 400 \}\);/);
});

test("sales-plan UI uses the same fail-closed moderation rule", () => {
  const source = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /!user\s*\|\|[\s\S]{0,80}user\.role === "director"/);
  assert.match(source, /const elevated = canModerateSalesPlan\(user\);/);
});
