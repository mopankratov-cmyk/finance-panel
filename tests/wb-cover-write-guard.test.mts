import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Запись главного фота на карточку WB НЕОБРАТИМА: media/save заменяет набор
 * медиафайлов целиком, а оригиналы из WB потом не достать. У соседей по рынку
 * ровно этот путь стоил шести карточек: они снимали «базу» с витрины, где WB
 * отдаёт максимум 900×1200, и заливали её обратно.
 *
 * У нас было хуже: на запись уходил массив, собранный на экране из миниатюр
 * 246×328, и нажать кнопку могла любая живая сессия. Не выстрелило ни разу —
 * cover_tests пуста, — но заряжено было.
 */

test("обложку переписывает только директор", () => {
  const route = read("../app/api/cover-test/route.ts");
  assert.match(route, /const gate = await requireApiSession\(\["director"\]\);/);
  assert.equal(
    /const gate = await requireApiSession\(\);\s*\n\s*if \(gate\) return gate;\s*\n\s*const db = getSupabaseAdmin/.test(route),
    false,
    "раньше хватало любой роли, включая финансиста и менеджера",
  );
});

test("что писать решает сервер, а не пришедший с экрана массив URL", () => {
  const route = read("../app/api/cover-test/route.ts");
  // Клиент присылает НОМЕР фотографии; набор берётся свежим запросом к WB.
  assert.match(route, /photoIndex\?: number;/);
  assert.match(route, /const card = await fetchCardForWrite\(token, nmId\);/);
  assert.match(route, /const photosBefore = card\.photos;/);
  assert.match(route, /const photosAfter = \[photosBefore\[index\], \.\.\.photosBefore\.filter\(\(_, i\) => i !== index\)\];/);
  assert.equal(
    /saveCardMediaOrder\(token, nmId, body\.photosAfter\)/.test(route),
    false,
    "массив с экрана на запись не уходит",
  );
  // Набор мог измениться между показом и нажатием — тогда отказ, а не запись.
  assert.match(route, /Обновите страницу — набор изменился/);
  assert.match(route, /WB не подтвердил карточку — запись отменена/);
});

test("на запись уходит большой размер, а не витринная миниатюра", () => {
  const cards = read("../lib/wb/cards.ts");
  // Два массива с разным назначением: превью и то, что уходит наружу.
  // WB отдаёт шесть размеров; hq (1800×2400) вдвое больше big (900×1200).
  // Писать big значило бы необратимо срезать галерею вдвое.
  assert.match(cards, /interface RawPhoto \{ hq\?: string;/);
  assert.match(cards, /photos: \(found\.photos \?\? \[\]\)\.map\(\(p\) => p\.hq \|\| p\.big \|\| ""\)\.filter\(Boolean\)/);
  assert.match(cards, /const photosBig = \(c\.photos \|\| \[\]\)\.map\(\(p\) => p\.hq \|\| p\.big \|\| p\.c246x328 \|\| ""\)\.filter\(Boolean\);/);
  const modal = read("../components/pim/CoverTestModal.tsx");
  assert.match(modal, /photoIndex: picked,/);
  assert.match(modal, /photoName: row\.photos\[picked\]\?\.split\("\/"\)\.pop\(\)/);
  assert.equal(/photosAfter/.test(modal), false, "экран больше не собирает набор для записи");
  // Генерация просит 1536×2048 — с миниатюры это дорисовка, а не апскейл.
  const generate = read("../app/api/ugc/generate/route.ts");
  assert.match(generate, /product\.photosBig\[0\] \?\? product\.photos\[0\]/);
});

test("карточка с видео и карточка из одного фото к записи не допускаются", () => {
  const route = read("../app/api/cover-test/route.ts");
  assert.match(route, /if \(card\.hasVideo\)/);
  assert.match(route, /card\.photos\.length < 2/);
  // Неподтверждённая карточка — тоже отказ: fail-closed, а не «на всякий случай».
  const cards = read("../lib/wb/cards.ts");
  assert.match(cards, /const blocked: CardForWrite = \{ found: false, hasVideo: true, photos: \[\] \};/);
});

test("номер фото сверяется с именем файла: порядок на WB мог измениться", () => {
  // Номер — ссылка в набор, который человек видел. Если порядок на WB успел
  // поменяться, тот же номер укажет на ЧУЖОЕ фото, и главным станет не то,
  // на что нажали. Имя файла одинаково у всех размеров одного фото.
  const route = read("../app/api/cover-test/route.ts");
  assert.match(route, /const chosenName = String\(photoName\)\.split\("\/"\)\.pop\(\) \?\? "";/);
  assert.match(route, /!card\.photos\[index\]\.endsWith\(`\/\$\{chosenName\}`\)/);
  assert.match(route, /Порядок фото на WB изменился/);
  assert.match(route, /!photoName/);
});
