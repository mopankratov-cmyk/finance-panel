import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Планировщик Vercel зовёт каждый крон МЕТОДОМ GET. Роут, объявленный одним
// `POST`, отвечает ему 405 — и это не видно ниоткуда: в приложение запрос не
// заходит, в логах приложения пусто, на экране функция выглядит включённой.
//
// Так полтора суток молчала автосмена фото в CTR-тестах: расписание стояло,
// секрет был на месте, роут работал — а метод не совпадал. Тест владельца
// простоял 29 часов, набрал 30 352 показа при норме раунда 350 и не
// переключился ни разу.
//
// Проверка дешёвая и ловит ровно этот класс: каждый путь из `crons` должен
// вести в существующий роут, который умеет отвечать на GET.
test("каждый крон из vercel.json ведёт в роут, отвечающий на GET", () => {
  const root = process.cwd();
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    crons?: { path: string; schedule: string }[];
  };
  const crons = config.crons ?? [];
  assert.ok(crons.length > 0, "в vercel.json не осталось ни одного крона — расписание потеряно");

  const broken: string[] = [];
  for (const { path } of crons) {
    const clean = path.split("?")[0].replace(/^\/+/, "");
    const file = join(root, "app", clean, "route.ts");
    if (!existsSync(file)) {
      broken.push(`${path} — файла ${clean}/route.ts нет`);
      continue;
    }
    const source = readFileSync(file, "utf8");
    if (!/export\s+(async\s+)?function\s+GET\b/.test(source) && !/export\s+const\s+GET\b/.test(source)) {
      broken.push(`${path} — роут не экспортирует GET, планировщик получит 405`);
    }
  }

  assert.deepEqual(broken, [], `кроны, до которых запрос не дойдёт:\n  ${broken.join("\n  ")}`);
});
