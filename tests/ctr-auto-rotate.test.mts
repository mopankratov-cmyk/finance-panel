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
  const write = route.indexOf("replaceCardCover(");
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
  assert.match(route, /if \(!card\.found\)/, "WB не подтвердил карточку — не пишем");
  // Отказа по видео здесь БОЛЬШЕ НЕТ, и это не послабление, а следствие смены
  // метода: `media/save` переписывал весь набор медиа, поэтому видео было под
  // угрозой и его приходилось обходить стороной — ценой того, что автоматика
  // не работала на 56% карточек кабинета. Замена по номеру позиции видео не
  // касается вовсе, обходить больше нечего.
  assert.doesNotMatch(route, /card\.hasVideo/, "проверка на видео вернулась вместе с перезаписью всего набора?");
  assert.doesNotMatch(route, /saveCardMediaOrder/, "перезапись всего набора медиа вернулась в ротацию");
});

test("мёртвая зона и норма показов соблюдаются", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  assert.match(route, /sinceSwitch < test\.dead_zone_min/, "клики по прежней картинке не считаем новой");
  assert.match(route, /volume < test\.impressions_per_round/, "переключаем только по набранной норме");
});

test("меняется ровно одна позиция — обложка", () => {
  const media = read("../lib/wb/media.ts");
  // Номер позиции задаётся заголовком и равен единице: остальные фото и видео
  // остаются на месте по построению, а не потому, что мы их аккуратно
  // переписали обратно. Раньше набор собирался руками, и любая ошибка в сборке
  // означала потерю кадров из живой карточки.
  assert.match(media, /"X-Photo-Number": "1"/, "меняем первую позицию, то есть обложку");
  assert.match(media, /"X-Nm-Id": String\(nmId\)/);
  assert.match(media, /content\/v3\/media\/file/, "метод замены одной позиции");

  const route = read("../app/api/ctrtest/rotate/route.ts");
  // Исходный набор по-прежнему записывается — но уже как след для человека,
  // а не как основа для сборки.
  assert.match(route, /photos_original/);
  assert.doesNotMatch(route, /\.\.\.base\.slice\(1\)/, "сборка набора руками вернулась");
});

test("неудача автоматики не молчит", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  // Отметка и причина пишутся в блоке finally — то есть при любом исходе,
  // включая отказ. Проверяем это по существу, а не по форме записи: объект
  // обновления переформатируется при каждой правке соседних строк.
  assert.match(route, /auto_checked_at: new Date\(\)\.toISOString\(\)/);
  assert.match(route, /auto_error: failure/);
  const finallyBlock = route.slice(route.indexOf("} finally {"));
  assert.match(finallyBlock, /auto_checked_at/, "отметка должна стоять в finally, иначе тихий отказ не запишется");
  assert.match(read("../components/wb/ctr/CtrTestDetail.tsx"), /test\.autoError/, "экран показывает причину");
});

/** У ротации ровно один хозяин: либо человек, либо крон. */
test("запрет узкий: автоматика не забирает у человека весь тест", () => {
  // Первая версия накрывала любое действие: тест с автоматикой нельзя было ни
  // запустить, ни остановить, ни отменить — владелец терял возможность
  // прервать то, что панель делает с витриной.
  const sql = read("../supabase/migrations/202609050003_ctr_auto_gate_narrow.sql");
  assert.match(sql, /if p_auto and not v_live then/, "крон не трогает тест с выключенной автоматикой");
  assert.doesNotMatch(sql, /if v_live and not p_auto then/, "человеку весь тест не запрещаем");

  // Вторая половина правила — в роуте, и только для переключения раундов.
  const action = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.match(action, /if \(action === "advance"\) \{[\s\S]*?live_swap_enabled/);
  assert.match(action, /Раунды переключает автоматика/);
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

/**
 * Переключатель автоматики сначала не работал вовсе: экран не подставлял
 * подтверждение (сервер отвечал «Нужно явное подтверждение действия»), а роут
 * читал намерение из `force`, который означает совсем другое — закрыть тест при
 * неравной открутке. То есть даже пройдя подтверждение, кнопка всегда бы
 * ВЫКЛЮЧАЛА автоматику.
 */
test("переключатель автоматики подтверждается и различает вкл/выкл", () => {
  const page = read("../components/wb/WbCtrPage.tsx");
  assert.match(page, /actionName === "auto"\s*\?\s*"AUTO_ROTATE"/);
  assert.match(page, /if \(actionName === "auto"\)/, "после смены режима список перечитывается");

  const route = read("../app/api/ctrtest/[id]/action/route.ts");
  assert.match(route, /const enabled = String\(body\?\.explanation \?\? ""\) === "on";/);
  assert.doesNotMatch(route, /const enabled = body\?\.force === true;/, "force здесь про другое");
});

/** Экран не должен предлагать то, что гейт отклонит. */
test("у автоматического теста нет кнопки ручного перехода", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  assert.match(detail, /test\.status === "running" && next && !test\.liveSwapEnabled \? <button/);
  // И запуск не просит поставить руками то, что уже стоит на карточке.
  assert.match(detail, /if \(action === "start" && auto\)/);
  assert.match(detail, /фото, которое сейчас стоит на карточке/);
});

/**
 * Ссылка на «Текущее фото» собиралась формулой баскета, а она протухает при
 * каждой разрезке у WB: на живом тесте HT-83-26 формула дала basket-48, а
 * карточка лежит на basket-47 — в базу лёг мёртвый адрес. Для показа это
 * битая картинка; для АВТОМАТИКИ — адрес, который уйдёт в запись на карточку.
 */
test("адрес обложки проверяется у WB, а не вычисляется формулой", () => {
  const helper = read("../lib/wb/cardImage.ts");
  assert.match(helper, /export async function resolveWbCardCoverUrl/);
  assert.match(helper, /return null;/, "неподтверждённый адрес не выдаётся за проверенный");

  const route = read("../app/api/ctrtest/list/route.ts");
  assert.match(route, /const baseIndex = normalized\.value\.variants\.findIndex\(\(variant\) => variant\.source === "current"\)/);
  assert.match(route, /await resolveWbCardCoverUrl\(normalized\.value\.nmId/, "чиним на сервере, не доверяя клиенту");
});

test("битая картинка варианта не превращает экран в набор поломанных иконок", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  assert.match(detail, /function VariantImage/);
  assert.match(detail, /onError=\{\(\) => setBroken\(true\)\}/);
  assert.match(detail, /фото не открылось/, "подпись честнее пустого прямоугольника");
});

test("повторный отказ останавливает тест, а не бьётся в стену", () => {
  const route = read("../app/api/ctrtest/rotate/route.ts");
  // Пока отказ повторялся молча, тест значился идущим неделями: на живом
  // NV-01-35 ротация упиралась в видео каждые пять минут, а экран показывал
  // «идёт» — человек считал, что варианты сменяются, пока крутился один.
  assert.match(route, /failure === test\.auto_error/, "сравниваем с прошлым отказом");
  assert.match(route, /status: "paused"/, "второй одинаковый отказ подряд ставит тест на паузу");
  assert.match(route, /auto_error/, "причина отказа читается из теста");
});

test("идущий раунд виден в таблице, а не показан нулями", () => {
  const detail = read("../components/wb/ctr/CtrTestDetail.tsx");
  // Итоги раунда пишутся при его ЗАКРЫТИИ. Пока первый раунд идёт — а это
  // часы, — таблица показывала нули, и работающий тест выглядел сломанным.
  assert.match(detail, /variant\.id === test\.currentVariantId/, "живая дельта идёт только текущему варианту");
  assert.match(detail, /const total = \(variant/, "показатели складываются с дельтой идущего раунда");
  assert.doesNotMatch(detail, /number\(variant\.impressions\)/, "вернулся показ только накопленного");
});
