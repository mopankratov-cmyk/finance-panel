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

test("sales-plan UI submits only after autosave is clean", () => {
  const source = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(saving \|\| dirty \|\| saveError \|\| conflict\) \{/);
  assert.match(source, /const submitDisabled = saving \|\| dirty \|\| Boolean\(saveError\) \|\| conflict;/);
  assert.match(source, /disabled=\{submitDisabled\} title=\{submitDisabledHint\}/);
});

test("sales-plan API approves and returns selected month only", () => {
  const source = readFileSync(new URL("../app/api/sales-plan/route.ts", import.meta.url), "utf8");

  assert.match(source, /const monthKey = normalizeSalesPlanMonthKey\(body\.monthKey \?\? body\.month\);/);
  assert.match(source, /getSalesPlanMonthState\(current, monthKey\)\.status !== "review"/);
  assert.match(source, /approvedByMonth = \{ \.\.\.approvedByMonth, \[monthKey\]: next \};/);
  assert.match(source, /getApprovedSalesPlanForMonth\(envelope, monthKey\)/);
});

test("sales-plan UI sends active month and reads monthly approved snapshot", () => {
  const source = readFileSync(new URL("../components/planning/SalesPlanPage.tsx", import.meta.url), "utf8");

  assert.match(source, /body: JSON\.stringify\(\{ action, expectedRevision: serverRevision\.current, monthKey: activeMonth,/);
  assert.match(source, /const activeApprovedPlan = getApprovedSalesPlanForMonth\(approvedEnvelope, activeMonth\);/);
  assert.match(source, /approvedPlan=\{activeApprovedPlan\}/);
  assert.match(source, /getSalesPlanMonthState\(plan, activeMonth\)\.status !== "draft"/);
});
