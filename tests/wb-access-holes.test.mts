import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Четыре двери, которые открывались тихо: сбой базы делал любого директором,
 * отключённая учётка ещё неделю видела кабинеты, админ кабинета доставал
 * директора панели, а разбор агента и история ставок шли мимо контура доступа.
 */

test("бутстрап директора — только при подтверждённом нуле пользователей", () => {
  const users = read("../lib/auth/users.ts");
  assert.match(users, /export async function countUsers\(\): Promise<number \| null>/);
  assert.match(users, /if \(error\) return null;/);
  assert.match(users, /if \(total === null\) return \{ ok: false/);
  assert.equal(
    /const \{ count \} = await db\.from\("app_users"\)/.test(users),
    false,
    "ошибка чтения превращалась в ноль, а ноль открывал создание директора",
  );
});

test("нет куки — машина, есть кука без сессии — отказ", () => {
  const access = read("../lib/auth/cabinetAccess.ts");
  assert.match(access, /async function looksLikeMachineCall/);
  assert.match(access, /return !jar\.get\(SESSION_COOKIE\)\?\.value;/);
  assert.match(access, /if \(!session && !\(await looksLikeMachineCall\(\)\)\) return false;/);
});

test("команда кабинета распоряжается только селлерами", () => {
  const team = read("../app/api/wb/team/route.ts");
  assert.match(team, /if \(String\(data\.role \?\? ""\) !== "seller"\) return null;/);
  assert.match(team, /if \(isPanelOwner\(data\.email\)\) return null;/);
  // Тот же запрет на пути создания: своя организация — не повод переписать
  // директора панели.
  assert.match(team, /String\(existing\.role \?\? ""\) !== "seller" \|\| isPanelOwner\(existing\.email\)/);
});

test("агент и история ставок проверяют доступ к кабинету", () => {
  const agent = read("../app/api/agent/route.ts");
  assert.equal((agent.match(/await hasCabinetAccess\(cabinetId\)/g) ?? []).length, 2, "обе ветки агента");
  const changes = read("../app/api/adverts/changes/route.ts");
  assert.match(changes, /await requireApiSession\(\)/);
  assert.match(changes, /if \(cabinetId\) query = query\.eq\("cabinet_id", cabinetId\)/);
  const page = read("../app/adverts/page.tsx");
  assert.match(page, /api\/adverts\/changes\$\{cabId \? `\?cabinet=\$\{cabId\}` : ""\}/);
});
