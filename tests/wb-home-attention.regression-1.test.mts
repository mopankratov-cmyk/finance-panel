import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/wb/page.tsx", "utf8");
const homeSource = readFileSync("components/wb/WbHomePage.tsx", "utf8");
const shellSource = readFileSync("components/wb/WbShell.tsx", "utf8");

test("WB root renders its own attention home instead of aliasing RNP", () => {
  assert.match(pageSource, /WbHomePage/);
  assert.doesNotMatch(pageSource, /from "\.\/rnp\/page"/);
});

test("WB home loads live signals safely and filters OK out of attention queue", () => {
  assert.match(homeSource, /\/api\/signals\?\$\{cabinetParam\(cabinetId\)\}&window=14&persist=0/);
  assert.match(homeSource, /readOkApiResponse<SignalsData>\(response, "Сигналы WB"\)/);
  assert.match(homeSource, /\.filter\(\(item\) => item\.signal !== "OK"\)/);
  assert.match(homeSource, /SEVERITY_WEIGHT\[b\.severity\] - SEVERITY_WEIGHT\[a\.severity\]/);
});

test("WB home routes signal cards to the operational modules", () => {
  assert.match(homeSource, /signal === "Остатки"[\s\S]*"\/wb\/supplies"/);
  assert.match(homeSource, /signal === "Маржа"[\s\S]*"\/wb\/unit"/);
  assert.match(homeSource, /signal === "ДРР" \|\| signal === "Реклама"[\s\S]*"\/wb\/adverts"/);
  assert.match(homeSource, /signal === "Контент"[\s\S]*"\/wb\/product"/);
  assert.match(homeSource, /signal === "Конкуренты"[\s\S]*"\/wb\/market"/);
});

test("WB shell logo opens the WB home with the selected cabinet", () => {
  assert.match(shellSource, /href=\{`\/wb\?cabinet=\$\{encodeURIComponent\(cabinetId \|\| "all"\)\}`\}/);
  assert.match(shellSource, /"\/wb": Home/);
});
