import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { relevantDatasets, stripMoney } from "../lib/assortment/brightdata.ts";

/** Пилот Bright Data: цены не проходят, пилот — только у руководителя. */

const root = fileURLToPath(new URL("..", import.meta.url));

test("Цены и деньги вырезаются на любой глубине", () => {
  const record = { title: "Bomber", final_price: 59.9, currency: "EUR", colors: [{ name: "black", price: 1 }], meta: { initial_price: 79, badge: "NEW" } };
  assert.deepEqual(stripMoney(record), { title: "Bomber", colors: [{ name: "black" }], meta: { badge: "NEW" } });
  assert.doesNotMatch(JSON.stringify(stripMoney(record)), /price|currency|59|79/);
});

test("Из каталога Bright Data берём только сайты одежды и соцсети", () => {
  const list = relevantDatasets([
    { id: "gd_1", name: "Zara - products", size: 100 },
    { id: "gd_2", name: "Amazon - products" },
    { id: "gd_3", name: "Instagram - posts" },
    { id: "gd_4", name: "LinkedIn - profiles" },
    { name: "без id" },
  ]);
  assert.deepEqual(list.map((d) => d.name), ["Instagram - posts", "Zara - products"]);
});

test("Пилот стоит денег — запускает только руководитель", () => {
  const route = readFileSync(join(root, "app/api/assortment-development/brightdata/route.ts"), "utf8");
  assert.match(route, /requireApiSession\(ASSORTMENT_ROLES\)/);
  assert.match(route, /includes\("director"\)/);
  assert.doesNotMatch(readFileSync(join(root, "lib/assortment/brightdata.ts"), "utf8"), /unlocker|zone=/i, "веб-анлокер (обход защиты) не используем");
});
