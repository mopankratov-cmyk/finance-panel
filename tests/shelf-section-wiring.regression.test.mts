import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// Раздел «Полки» держится на трёх контрактах: сборщик ходит под CRON_SECRET,
// экран — под сессией с проверкой кабинета, а удаление истории требует явного
// подтверждения. Разъезд любого из них — тихая дыра, поэтому сторожим текстом.

test("эндпоинты сборщика закрыты cron-авторизацией", async () => {
  for (const path of ["../app/api/shelf/watchlist/route.ts", "../app/api/shelf/ingest/route.ts"]) {
    const source = await read(path);
    assert.match(source, /checkCronAuth\(request\)/, `${path} без checkCronAuth`);
    assert.doesNotMatch(source, /requireApiSession/, `${path} не должен требовать сессию — сборщик безголовый`);
  }
});

test("экранные эндпоинты под сессией и проверкой кабинета", async () => {
  for (const path of ["../app/api/shelf/watch/route.ts", "../app/api/shelf/table/route.ts"]) {
    const source = await read(path);
    assert.match(source, /requireApiSession/, `${path} без requireApiSession`);
    assert.match(source, /hasCabinetAccess/, `${path} без hasCabinetAccess`);
  }
});

test("удаление артикула с историей требует явного подтверждения", async () => {
  const source = await read("../app/api/shelf/watch/route.ts");
  assert.match(source, /DELETE_WATCH_WITH_HISTORY/);
  const page = await read("../components/wb/WbShelfPage.tsx");
  assert.match(page, /DELETE_WATCH_WITH_HISTORY/);
  assert.match(page, /window\.confirm/);
});

test("раздел заведён в навигацию WB, но скрыт от внешнего селлера", async () => {
  const navigation = await read("../lib/wb/navigation.ts");
  assert.match(navigation, /"\/wb\/shelf"/);
  const shell = await read("../components/wb/WbShell.tsx");
  assert.match(shell, /"\/wb\/shelf": Rows3/);
  // roles.ts и proxy селлера в раздел не пускают — пункт меню был бы мёртвой ссылкой.
  assert.match(shell, /filter\(\(item\) => item\.href !== "\/wb\/shelf"\)/);
  const roles = await read("../lib/auth/roles.ts");
  assert.doesNotMatch(roles, /seller:[^\]]*\/wb\/shelf/);
});

test("контракт сборщика: panelClient шлёт Bearer на оба эндпоинта", async () => {
  const client = await read("../tools/shelf-collector/src/panelClient.js");
  assert.match(client, /\/api\/shelf\/watchlist/);
  assert.match(client, /\/api\/shelf\/ingest/);
  const bearerCount = client.match(/Bearer \$\{secret\}/g)?.length ?? 0;
  assert.equal(bearerCount, 2, "Bearer нужен и на GET, и на POST");
});

test("scrape.js перенесён без изменений — антибот-эмпирики автора сохранены", async () => {
  const scrape = await read("../tools/shelf-collector/src/scrape.js");
  // Ключевые эмпирические решения, которые нельзя потерять при будущих правках.
  assert.match(scrape, /MAX_NAVIGATION_ATTEMPTS = 5/);
  assert.match(scrape, /AntibotBlockedError/);
  assert.match(scrape, /priceBlockWalletPrice/);
  assert.match(scrape, /data-popup-nm-id/);
});
