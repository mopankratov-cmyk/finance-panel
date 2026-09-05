import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Автоматическая смена вариантов пишет в ЖИВУЮ карточку на витрине WB, и
 * запись необратима. Всё, что здесь проверяется, — про порядок и границы, а
 * не про удобство.
 */
test("сначала фото в карточку, потом отметка раунда", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  const write = route.indexOf("saveCardMediaOrder(");
  const transition = route.indexOf('rpc("transition_ctr_test"');
  assert.ok(write > 0 && transition > 0);
  assert.ok(write < transition,
    "отметить раунд раньше записи значит считать, что крутится вариант, которого на витрине нет");
});

test("ротация не трогает то, что трогать нельзя", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  assert.match(route, /checkCronAuth\(request\)/, "только крон");
  assert.match(route, /\.eq\("live_swap_enabled", true\)/, "только тесты с включённой автоматикой");
  assert.match(route, /\.eq\("status", "running"\)/);
  assert.match(route, /if \(card\.hasVideo\)/, "карточки с видео не трогаем");
  assert.match(route, /if \(!card\.found\)/, "WB не подтвердил карточку — не пишем");
});

test("мёртвая зона и норма показов соблюдаются", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  assert.match(route, /sinceSwitch < test\.dead_zone_min/, "клики по прежней картинке не считаем новой");
  assert.match(route, /volume < test\.impressions_per_round/, "переключаем только по набранной норме");
});

test("галерея не растёт и не теряет кадры", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  // Каждая запись строится от ИСХОДНОГО набора, а не от текущего: иначе
  // вариант прошлого раунда оставался бы в карточке навсегда.
  assert.match(route, /photos_original/);
  assert.match(route, /\[next\.image_url, \.\.\.base\.slice\(1\)\]/);
});

test("неудача автоматики не молчит", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  assert.match(route, /auto_checked_at: new Date\(\)\.toISOString\(\), auto_error: failure/);
  assert.match(read("../components/wb/ctr/CtrTestDetail.tsx"), /test\.autoError/, "экран показывает причину");
});

/** У ротации ровно один хозяин: либо человек, либо крон. */
test("гейт разворачивает запрет в обе стороны", () => {
  const sql = read("../supabase/migrations/202609050001_ctr_auto_rotate.sql");
  assert.match(sql, /if v_live and not p_auto then/, "человек не двигает тест, которым правит крон");
  assert.match(sql, /if p_auto and not v_live then/, "крон не трогает тест с выключенной автоматикой");
  const transition = read("../supabase/migrations/202609050002_ctr_transition_auto.sql");
  assert.match(transition, /perform public\.ctr_auto_gate/);
  // Фраза остаётся в шапке-объяснении файла — смотрим на тело функции.
  const body = transition.slice(transition.indexOf("create or replace function"));
  assert.doesNotMatch(body, /raise exception 'live swap must remain disabled'/, "прежний безусловный запрет снят");
});

test("переключать способ ротации можно только у остановленного теста", () => {
  const action = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.match(action, /auto: "AUTO_ROTATE"/, "необратимое включение требует подтверждения");
  assert.match(action, /requireApiSession\(\["director"\]\)/);
  assert.match(action, /if \(test\.status === "running"\)/);
});

test("ротация запускается по расписанию", () => {
  const vercel = JSON.parse(read("../vercel.json")) as { crons?: { path: string; schedule: string }[] };
  const cron = (vercel.crons ?? []).find((item) => item.path.startsWith("/api/ctrtest/rotate"));
  assert.ok(cron, "без крона автоматика не автоматика");
  assert.equal(cron?.schedule, "*/5 * * * *");
});

/**
 * Все пять ключей кабинетов выпущены «только на чтение»: WB отвечает 403 и
 * прямым текстом `read-only token cannot perform non-readonly requests`.
 * Автоматическая смена на таком ключе не заработает никогда, и человек обязан
 * узнать это ДО запуска теста, а не из ошибки крона.
 */
test("право записи спрашивают у WB, а не выводят из токена", () => {
  const media = read("../lib/wb/media.ts");
  assert.match(media, /export async function probeContentWriteAbility/);
  assert.match(media, /read-only token/i, "узнаём отказ по ответу WB");
  assert.match(media, /const PROBE_NM_ID = 1;/, "проба по несуществующей карточке ничего не меняет");
  // Разбор битовой маски JWT здесь ненадёжен — WB её официально не раскрывает.
  assert.doesNotMatch(media, /decodeWbToken/);
});

test("ключ контента вводится в модуле тестов и не возвращается наружу", () => {
  const route = read("../app/api/ctrtest/token/route.ts");
  assert.match(route, /requireApiSession\(\["director"\]\)/);
  assert.match(route, /hasCabinetAccess\(cabinetId\)/);
  assert.match(route, /`••••\$\{token\.trim\(\)\.slice\(-4\)\}`/, "наружу только маска");
  assert.match(route, /verdict\.canWrite\)/, "ключ на чтение сохранять незачем");

  const panel = read("../components/wb/ctr/CtrTokenPanel.tsx");
  assert.match(panel, /type="password"/, "ключ не показываем на экране");
  assert.match(panel, /«Только на чтение» снять/, "сказано, какой именно ключ нужен");
});
