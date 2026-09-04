import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../components/wb/useWbSkuNames.ts", import.meta.url), "utf8");
const funnel = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
const shelf = readFileSync(new URL("../components/wb/WbShelfPage.tsx", import.meta.url), "utf8");
const rnp = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
const identityCell = readFileSync(new URL("../components/wb/WbSkuIdentityCell.tsx", import.meta.url), "utf8");

test("названия карточек WB видны в Полках, Воронке и РНП", () => {
  // Запрос владельца: в Полках — названия к артикулам, в Воронке и РНП —
  // чтобы имя не падало обратно в артикул у кабинетов без себестоимости.
  // Полки зовут хук через shelfCabinet: он null и без точного кабинета, и на
  // вкладке «Конкуренты», где справочник никто не читает.
  assert.match(shelf, /const shelfCabinet = view === "shelf" && hasExactCabinet \? cabinetId : null;/);
  assert.match(shelf, /useWbSkuNames\(shelfCabinet\)/);
  assert.match(shelf, /displaySkuName\(watch\.supplierArticle \?\? "", null, skuNames, watch\.nmId\)/);
  // Воронка рисует общую ячейку личности SKU — имя берётся тем же способом,
  // на шаг глубже.
  assert.match(funnel, /<WbSkuIdentityCell article=\{sku\.art\} nm=\{sku\.nm\} serverName=\{sku\.name\} directory=\{skuNames\}/);
  assert.match(identityCell, /displaySkuName\(code, serverName \?\? null, directory, nm\)/);
  assert.match(rnp, /name: displaySkuName\(sku\.art, sku\.name, skuNames, sku\.nm\) \|\| sku\.name/);
});

test("имя, совпадающее с артикулом, считается фолбэком, а не названием", () => {
  assert.match(hook, /if \(server && server !== article\) return server;/);
  // Недоступность справочника не роняет экран.
  assert.match(hook, /catch\(\(\) => \{\}\)/);
});
