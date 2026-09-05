import assert from "node:assert/strict";
import test from "node:test";
import { wbPhotoBig, wbPhotoThumb } from "../lib/wb/photoUrl";

/**
 * Замер 05.09.2026 по двадцати карточкам: у ДЕВЯТНАДЦАТИ ссылка `hq` отдаёт
 * 404, а тот же кадр через `/big/` открывается. Content API возвращает поле,
 * которого на CDN чаще всего нет.
 *
 * Ошибка была тихой: миниатюры живут по третьему пути, поэтому сетка превью
 * выглядела целой, а наружу — в вариант CTR-теста, в генерацию — уходил
 * мёртвый адрес. Ломалось не у нас, а у того, кто пробовал его скачать.
 */
test("большое фото берётся из big, а не из hq", () => {
  const photo = {
    hq: "https://basket-39.wbbasket.ru/vol1/part1/1/images/hq/1.webp",
    big: "https://basket-39.wbbasket.ru/vol1/part1/1/images/big/1.webp",
    c246x328: "https://basket-39.wbbasket.ru/vol1/part1/1/images/c246x328/1.webp",
  };
  assert.equal(wbPhotoBig(photo), photo.big, "big есть всегда — он и уходит наружу");
  assert.equal(wbPhotoThumb(photo), photo.c246x328);
});

test("без big отдаём то, что есть, а не пустоту", () => {
  assert.equal(wbPhotoBig({ hq: "h" }), "h", "hq лучше, чем ничего");
  assert.equal(wbPhotoBig({ c516x688: "m" }), "m");
  assert.equal(wbPhotoBig({ c246x328: "t" }), "t");
  assert.equal(wbPhotoBig({}), "");
  assert.equal(wbPhotoThumb({ big: "b" }), "b");
  assert.equal(wbPhotoThumb({}), "");
});

test("разрешение уступает доступности", () => {
  // Кадр, который не скачивается, не имеет разрешения вовсе: hq крупнее, но
  // если рядом лежит big — наружу идёт big.
  const both = { hq: "hq-1800x2400", big: "big-900x1200" };
  assert.notEqual(wbPhotoBig(both), both.hq);
});
