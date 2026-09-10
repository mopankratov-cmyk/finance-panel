import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

test("любая объявленная роль может держать сессию", async () => {
  /**
   * Гейт пускает человека на страницу по подписанной куке, а роуты
   * перепроверяют сессию через getServerSession. Если роли там нет — страница
   * откроется, а данные нет: «Требуется вход» на каждом запросе.
   *
   * Это случалось дважды. Сначала так выключило оператора склада, и тогда в
   * список дописали одну роль. Потом, после разделения ролей, список отстал
   * снова и выключил менеджера WB — первого же сотрудника, заведённого по
   * новому ТЗ. Поэтому список оттуда убран совсем: сверка идёт со словарём, и
   * совпадение теперь не поддерживается руками, а обеспечено по построению.
   */
  const server = readFileSync(new URL("../lib/auth/server.ts", import.meta.url), "utf8");
  assert.match(server, /if \(!isRole\(data\.role\)\) return null;/);
  assert.doesNotMatch(server, /\]\.includes\(String\(data\.role\)\)/, "вернулся список ролей, написанный руками");

  const { ROLE_PERMISSIONS, isRole } = await import("../lib/auth/permissions.ts");
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    assert.equal(isRole(role), true, `роль ${role} объявлена, но сессию держать не может`);
  }
});

test("оператору склада открыт только его модуль", async () => {
  const { canAccess } = await import("../lib/auth/roles.ts");
  assert.equal(canAccess("warehouse", "/warehouse"), true);
  assert.equal(canAccess("warehouse", "/opiu"), false);
  assert.equal(canAccess("warehouse", "/"), false);
});
