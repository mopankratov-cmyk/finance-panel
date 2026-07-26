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

test("sales-plan API blocks return without a moderation comment", () => {
  const source = readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");

  assert.match(source, /const returnComment = normalizeSalesPlanReturnComment\(body\.comment\);/);
  assert.match(source, /if \(!returnComment\) return NextResponse\.json\(\{ error: "Укажите комментарий возврата: что исправить в плане" \}, \{ status: 422 \}\);/);
  assert.match(source, /returnComment \}/);
});

test("sales-plan UI uses the same fail-closed moderation rule", () => {
  const source = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /!user\s*\|\|[\s\S]{0,80}user\.role === "director"/);
  assert.match(source, /const elevated = canModerateSalesPlan\(user\);/);
});

test("sales-plan UI asks for a return comment before calling the API", () => {
  const source = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

  assert.match(source, /const returnPlan = async \(\) =>/);
  assert.match(source, /window\.prompt\("Почему возвращаем план\? Укажите, что нужно исправить\."\)/);
  assert.match(source, /const comment = normalizeSalesPlanReturnComment\(rawComment\);/);
  assert.match(source, /persist\("return", plan, false, \{ comment \}\)/);
});
