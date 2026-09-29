import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * canManageStock(role: Role) проверяет ОДНУ роль. Сессия может нести
 * несколько (см. tests/multi-role.test.mts) — вторая роль обязана добавлять
 * доступ, не теряться за первой. 10 из 12 мест склада звали её как
 * canManageStock(session?.role)/canManageStock(session.role) — сотрудник с
 * основной ролью "warehouse" и второй управляющей ролью (например, buyer)
 * получал 403 на создании задания, коррекции приёмки, заведении начального
 * остатка и т.д., хотя два соседних места (tasks/[id]/cancel, docs/[id]/reverse)
 * уже правильно звали sessionRoles(session).some(role => canManageStock(role)).
 *
 * Ищем нарушение текстом по всему app/api/warehouse — не по списку
 * подозреваемых файлов: список подозреваемых — это ровно та же ручная копия,
 * только в тесте (тот же приём, что в multi-role.test.mts).
 */
test("canManageStock() в app/api/warehouse зовётся только через sessionRoles(...).some(...)", () => {
  const root = fileURLToPath(new URL("../app/api/warehouse", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(full);
    }
  };
  if (statSync(root).isDirectory()) walk(root); else files.push(root);

  const singleRoleCall = /canManageStock\(session\??\.role\)/;
  const offenders = files
    .filter((file) => singleRoleCall.test(readFileSync(file, "utf8")))
    .map((file) => file.split("/finance-panel/").pop() ?? file);

  assert.deepEqual(offenders, [], `canManageStock() по одной роли (session.role), не по sessionRoles(session):\n  ${offenders.join("\n  ")}`);
});
