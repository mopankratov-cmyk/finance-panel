import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("набор ролей не схлопывается при правке", () => {
  const route = read("app/api/users/[id]/route.ts");
  // Раньше здесь стояло `patch.roles = [b.role]`: любая правка оставляла одну
  // роль, и выдать вторую было нечем ни через экран, ни через API.
  // Якорь на начало строки: в файле рядом лежит комментарий, который эту
  // старую строку цитирует, и проверка без якоря ловила бы сам комментарий.
  assert.doesNotMatch(route, /^\s*patch\.roles = \[b\.role\];/m, "правка снова схлопывает набор ролей в одну");
  assert.match(route, /patch\.roles = nextRoles/, "набор ролей не записывается целиком");
  // Граница контуров проверялась только на заведении — правка обходила её.
  assert.match(route, /Внешнюю роль нельзя совмещать с внутренней/, "правка не проверяет смешение контуров");
});

test("экран отдаёт и показывает все роли сотрудника", () => {
  const list = read("app/api/users/route.ts");
  const page = read("app/users/page.tsx");
  assert.match(list, /select\("id, email, role, roles,/, "список пользователей не отдаёт набор ролей");
  assert.match(list, /return \{ \.\.\.user, roles,/, "набор ролей не доезжает до экрана");
  assert.match(page, /rolesOf\(u\)\.map/, "экран показывает не все роли строки");
  assert.match(page, /roles: next/, "экран шлёт одну роль вместо набора");
});

test("пороги согласования настраиваются из панели", () => {
  const card = read("components/access/LimitsCard.tsx");
  // Роут существовал с самого начала, но к нему не обращался ни один экран:
  // поменять порог можно было только запросом руками.
  assert.match(card, /fetch\("\/api\/limits"/, "карточка не читает пороги");
  assert.match(card, /method: "PUT"/, "карточка не умеет сохранять");
  for (const screen of ["app/users/page.tsx", "app/wb/team/page.tsx"]) {
    assert.match(read(screen), /<LimitsCard \/>/, `${screen}: пороги не выведены`);
  }
});

test("модули внешнего сотрудника доезжают до сервера", () => {
  const team = read("app/wb/team/page.tsx");
  // Сервер принимал модули с самого начала, а экран их не слал — и каждое
  // сохранение писало пустой список, то есть «открыты все три».
  assert.match(team, /action: "create", email, password, modules/, "модули не уходят в запрос");
  assert.match(team, /EXTERNAL_MODULES\.map/, "на экране нет выбора модулей");
});

test("журнал действий есть в меню", () => {
  const sidebar = read("components/Sidebar.tsx");
  // Экран был сделан и никуда не выведен: попасть в него можно было только
  // набрав адрес руками.
  assert.equal((sidebar.match(/href: "\/audit"/g) ?? []).length, 2, "журнал выведен не во всех меню");
});
