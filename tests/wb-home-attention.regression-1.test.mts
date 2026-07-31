import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync("app/wb/page.tsx", "utf8");
const shellSource = readFileSync("components/wb/WbShell.tsx", "utf8");

test("WB root redirects to RNP instead of rendering a separate home", () => {
  assert.match(pageSource, /redirect\("\/wb\/rnp"\)/);
  assert.doesNotMatch(pageSource, /WbHomePage/);
});

test("WB shell logo opens RNP with the selected cabinet", () => {
  assert.match(shellSource, /user\?\.role === "seller" && cabinets\.length === 0 \? "\/wb\/connect" : `\/wb\/rnp\?cabinet=\$\{encodeURIComponent\(cabinetId \|\| "all"\)\}`/);
  assert.doesNotMatch(shellSource, /"\/wb": Home/);
});
