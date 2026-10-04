import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cabinetBrandFilters, normalizeBrandFilters } from "../lib/wb/productScope";

/**
 * Бренды уже добавленного кабинета. 04.10.2026 добавлен кабинет «ЗОРИ», из
 * которого нужны только HEATON и NORVIA, а задать бренды можно было только при
 * сохранении кабинета вместе с токеном WB.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("бренды нормализуются так же, как при создании кабинета", () => {
  assert.deepEqual(normalizeBrandFilters(["HEATON", " NORVIA ", "norvia"]), ["heaton", "norvia"]);
  assert.deepEqual(cabinetBrandFilters("ЗОРИ Weara", normalizeBrandFilters(["HEATON", "NORVIA"])), ["heaton", "norvia"]);
  assert.deepEqual(cabinetBrandFilters("ЗОРИ Weara", []), [], "пусто — все бренды");
  // У «Оптимы» набор зашит в код и сильнее настройки.
  assert.deepEqual(cabinetBrandFilters("Оптима — NORVIA / RIOBOX Оптима", ["heaton"]), ["norvia", "riobox"]);
});

test("PATCH кабинета принимает бренды: только директор, только WB, без расхождения с зашитыми", () => {
  const route = read("../app/api/cabinets/[id]/route.ts");
  const patch = route.slice(route.indexOf("export async function PATCH("), route.indexOf("export async function DELETE("));
  assert.match(patch, /requireApiSession\(\["director"\]\)/);
  assert.match(patch, /patch\.brand_filters = normalizeBrandFilters\(b\.brand_filters\)/);
  assert.match(patch, /b\.brand_filters\.some\(\(item\) => typeof item !== "string"\)/, "только строки");
  assert.match(patch, /existing\.marketplace !== "wb"/);
  assert.match(patch, /status: 409/, "набор, который панель не применит, не сохраняется");
  assert.match(patch, /action: "cabinet\.update"/, "изменение попадает в аудит");
});

test("в списке кабинетов у WB — строка «Бренды» с правкой", () => {
  const page = read("../app/cabinets/page.tsx");
  assert.match(page, /Бренды: \{c\.brand_filters\?\.length \? c\.brand_filters\.join\(", "\) : "все"\}/);
  assert.match(page, /body: JSON\.stringify\(\{ brand_filters: brandFilters \}\)/);
  assert.match(page, /c\.marketplace === "wb" \? <div/);
});
