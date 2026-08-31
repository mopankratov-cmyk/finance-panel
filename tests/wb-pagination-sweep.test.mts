import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Потолок в тысячу строк — самый частый способ соврать в этом коде: ответ
 * приходит без ошибки, просто короче правды. Каждый из этих файлов терял на
 * нём данные, по которым человек принимает решение.
 */

test("выгрузка новых цен репрайсера листается", () => {
  const route = read("../app/api/repricer/export/route.ts");
  assert.match(route, /Репрайсер: выгрузка новых цен/);
  assert.equal(/const \{ data, error \} = await q;/.test(route), false);
});

test("сверка КИЗ читает все задания и все возвраты", () => {
  const store = read("../lib/wb/fbsKizStore.ts");
  assert.match(store, /КИЗ: сборочные задания из базы/);
  assert.match(store, /КИЗ: возвраты из базы/);
  assert.equal(/\.limit\(20_000\)/.test(store), false, "двадцать тысяч упирались в тысячу");
});

test("сигналы читают воронку целиком и не глотают ошибку", () => {
  const route = read("../app/api/signals/route.ts");
  assert.match(route, /Сигналы: воронка/);
  assert.equal(/const \{ data: frows \} = await funnelQuery;/.test(route), false);
});

test("задачи журнала РК: полный список, ошибка не выдаётся за пустоту", () => {
  const route = read("../app/api/wb/rk-notes/route.ts");
  assert.match(route, /Журнал РК: задачи/);
  assert.match(route, /if \(\/42P01\|PGRST205\|does not exist\/i\.test\(message\)\) return NextResponse\.json\(\{ notes: \[\] \}\)/);
  assert.match(route, /status: 502/);
});

test("репрайсер не рапортует об успехе при неудачной записи", () => {
  const run = read("../lib/repricer/run.ts");
  assert.match(run, /if \(removed\.error\) throw new Error/);
  assert.match(run, /if \(error\) throw new Error\(`Репрайсер: не удалось записать решения/);
  const route = read("../app/api/repricer/run/route.ts");
  assert.match(route, /Не удалось сохранить решения репрайсера/);
});
