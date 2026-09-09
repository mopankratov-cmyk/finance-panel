import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Каталог контента стал редактируемым: файл добавляют и убирают прямо со
 * страницы, не заходя в мастер теста. Дверей в один каталог теперь две, и
 * разъехаться они могут молча — разницу увидит не разработчик, а человек,
 * который снёс не тот файл.
 */

test("страница каталога кладёт и убирает файлы тем же роутом, что подборщик", () => {
  const page = read("components/wb/WbContentPage.tsx");
  const picker = read("components/wb/ctr/ContentPicker.tsx");

  for (const [name, source] of [["страница", page], ["подборщик", picker]] as const) {
    assert.match(source, /\/api\/content\/upload/, `${name} обязан ходить в общий роут каталога`);
    assert.match(source, /method: "DELETE"/, `${name}: удаление есть`);
  }
});

test("корзина только на том, чем распоряжается панель", () => {
  const page = read("components/wb/WbContentPage.tsx");
  // Кадр карточки живёт в WB, съёмка — в каталоге завода. Корзина на них
  // означала бы обещание, которого панель не может сдержать: роут такой запрос
  // отвергнет, а человек будет думать, что удалил.
  assert.match(page, /isPanelOwned\(item\.url\)/);
  assert.match(page, /window\.confirm/, "удаление необратимо — спрашиваем");
});

test("правка видна сразу, без перечитывания каталога", () => {
  const page = read("components/wb/WbContentPage.tsx");
  // Полноэкранный баннер уместен только на первой загрузке.
  assert.match(page, /loading && !data \?/);
  // А перечитывания после правки больше нет вовсе: библиотека отдаёт 2,6 МБ за
  // восемь секунд, и всё это время удалённая плитка оставалась на экране.
  assert.ok(!/reloadKey/.test(page), "счётчик перечитывания убран");
  assert.match(page, /patchProductItems/, "правка применяется к своему списку");
});
