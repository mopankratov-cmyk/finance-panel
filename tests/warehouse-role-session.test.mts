import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("роль оператора склада может держать сессию", () => {
  // Гейт-прокси пускает оператора на /warehouse и /api/warehouse/* по подписанной
  // куке, а роуты перепроверяют сессию через getServerSession. Если роли нет в
  // его списке, страница откроется, а данные — нет: 401 на каждом запросе.
  const server = readFileSync(new URL("../lib/auth/server.ts", import.meta.url), "utf8");
  const allowed = server.match(/if \(!\[(.*?)\]\.includes\(String\(data\.role\)\)\) return null;/s);
  assert.ok(allowed, "не нашёл список ролей, которым разрешена сессия");
  assert.match(allowed![1], /"warehouse"/, "оператор склада не может держать сессию");

  // Список обязан совпадать с тем, что вообще считается ролью.
  const session = readFileSync(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
  const declared = [...session.matchAll(/"(director|finance|manager|seller|warehouse)"/g)].map((m) => m[1]);
  for (const role of new Set(declared)) {
    assert.match(allowed![1], new RegExp(`"${role}"`), `роль ${role} объявлена, но сессию держать не может`);
  }
});

test("оператору склада открыт только его модуль", async () => {
  const { canAccess } = await import("../lib/auth/roles.ts");
  assert.equal(canAccess("warehouse", "/warehouse"), true);
  assert.equal(canAccess("warehouse", "/opiu"), false);
  assert.equal(canAccess("warehouse", "/"), false);
});
