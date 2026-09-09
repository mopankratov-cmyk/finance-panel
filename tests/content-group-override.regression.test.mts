import assert from "node:assert/strict";
import test from "node:test";

import { buildProductContent, itemsForTestType, roleOverride, type LibraryAssetRow, type LibraryCardRow } from "../lib/content/productLibrary";

/**
 * Половину экрана кадр получает по номеру, и это правило ошибается в обе
 * стороны: инфографика приезжает съёмкой без номера и садится в главные, а
 * удачный кадр карточки со второго места в главные не попадает, хотя обложкой
 * стать может. Пометка руками сильнее вычисленной — и обязана действовать на
 * ОБА пути, которыми один и тот же файл попадает в список.
 */

const cover = "https://basket-16.wbbasket.ru/vol1/part11/111/images/big/1.webp";
const frame3 = "https://basket-16.wbbasket.ru/vol1/part11/111/images/big/3.webp";
const shoot = "https://x.supabase.co/storage/v1/object/public/factory-media/shoots/A-1/9.webp";

const card: LibraryCardRow = {
  nm_id: 111,
  article: "A-1",
  name: "Куртка",
  subject: "Куртки",
  photos: [cover, "x", frame3],
  photos_big: [cover, "x", frame3],
  photos_count: 3,
};

const asset = (id: number, url: string, role: string | null): LibraryAssetRow => ({
  id, article: "A-1", kind: "image", url, name: `файл ${id}`, disk: "wb", niche: null, role,
});

test("без пометки половина считается по номеру кадра", () => {
  const [product] = buildProductContent([card], [asset(1, shoot, null)]);
  const groups = Object.fromEntries(product.items.map((item) => [item.url, item.group]));
  assert.equal(groups[cover], "main", "обложка — главное фото");
  assert.equal(groups[frame3], "funnel", "третий кадр — воронка");
  assert.equal(groups[shoot], "main", "съёмка без номера — кандидат в обложку");
});

test("пометка руками сильнее расчёта и действует на кадр галереи", () => {
  // Кадр 3 приходит ДВУМЯ путями: из галереи карточки и строкой каталога.
  // Пометка хранится по адресу, поэтому обязана переставить оба.
  const [product] = buildProductContent([card], [asset(2, frame3, "main"), asset(3, shoot, "funnel")]);
  const byUrl = new Map(product.items.map((item) => [item.url, item]));

  const promoted = [...product.items].filter((item) => item.url === frame3);
  assert.ok(promoted.length >= 1);
  for (const item of promoted) {
    assert.equal(item.group, "main", "помеченный кадр воронки стал главным на всех путях");
    assert.equal(item.groupPinned, true, "пометку видно, значит её можно снять");
  }

  assert.equal(byUrl.get(shoot)?.group, "funnel", "инфографику можно убрать из главных");
  assert.equal(byUrl.get(cover)?.groupPinned, false, "чего не трогали — то не помечено");
});

test("выбор вариантов CTR идёт по половине, а не по номеру кадра", () => {
  const [product] = buildProductContent([card], [asset(2, frame3, "main"), asset(3, shoot, "funnel")]);
  const forCtr = itemsForTestType(product.items, "ctr").map((item) => item.url);

  assert.ok(forCtr.includes(frame3), "поднятый кадр доступен вариантом теста");
  assert.ok(!forCtr.includes(shoot), "убранная в воронку съёмка вариантом не предлагается");
  assert.equal(itemsForTestType(product.items, "cr").length, product.items.length, "для CR список полный");
});

test("в role попадает только своё", () => {
  assert.equal(roleOverride("main"), "main");
  assert.equal(roleOverride("funnel"), "funnel");
  assert.equal(roleOverride("clean_front"), null, "чужие значения каталога — не наша пометка");
  assert.equal(roleOverride(null), null);
});
