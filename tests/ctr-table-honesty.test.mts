import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ctrGapVerdict } from "../lib/ctrtest/model.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const detail = () => read("../components/wb/ctr/CtrTestDetail.tsx");

/**
 * Экран сравнения обложек красит суждения, а не строки. Отсюда и правила: цвет
 * приговора можно включать только там, где приговор посчитан, и ровно на той
 * величине, по которой тест закончится.
 */

test("порог различимости считается для каждой пары, а не один на таблицу", () => {
  // Лидер 3,31% на 7 949 показах. Второй вариант откручен вчетверо меньше,
  // третий — всемеро: линейка у них разная, и общий порог для третьего был бы
  // просто неверен.
  const leader = { impressions: 7949, clicks: 263 };
  const wide = ctrGapVerdict(leader, { impressions: 4484, clicks: 116 });
  const narrow = ctrGapVerdict(leader, { impressions: 1224, clicks: 37 });
  assert.ok(wide && narrow);
  assert.ok(
    narrow!.detectableShare > wide!.detectableShare,
    "у варианта с меньшей выборкой порог обязан быть выше — иначе его признают проигравшим раньше времени",
  );
  assert.equal(narrow!.sample, 1224, "сравнение не надёжнее своей слабой стороны");
});

test("оценка «сколько ещё крутить» обратна квадрату разрыва", () => {
  // Различимая разница падает как 1/sqrt(n). Значит вдвое меньший разрыв
  // требует вчетверо большей выборки — это и должна показывать оценка.
  const big = ctrGapVerdict({ impressions: 2000, clicks: 80 }, { impressions: 2000, clicks: 40 });
  const small = ctrGapVerdict({ impressions: 2000, clicks: 80 }, { impressions: 2000, clicks: 78 });
  assert.ok(big && small);
  assert.ok(big!.decisive, "двукратный отрыв на двух тысячах — уже решение");
  assert.ok(!small!.decisive);
  assert.ok(small!.needSample! > big!.needSample!, "чем тоньше разрыв, тем больше нужно показов");
  assert.ok(small!.progress < 0.1, "на таком разрыве выборка едва начата");
});

test("равные варианты не получают обещания «ещё немного»", () => {
  // Ноль разрыва — это не «почти дошли», это отсутствие разницы. Числа
  // «нужно ещё N показов» тут не существует, и выдумывать его нельзя.
  const even = ctrGapVerdict({ impressions: 5000, clicks: 200 }, { impressions: 5000, clicks: 200 });
  assert.ok(even);
  assert.equal(even!.progress, 0);
  assert.equal(even!.needSample, null);
  assert.match(detail(), /надёжного ответа не даст никакая выборка/);
});

test("лидер получает изумруд приговора только после вердикта", () => {
  // Пока разрыв внутри погрешности, впереди идущий вариант — подсказка, а не
  // итог: ярлык «впереди» и бледная заливка вместо сплошной короны.
  const src = detail();
  assert.match(src, /verdict\?\.decisive \? "лидер" : "впереди"/, "ярлык обязан меняться вместе с вердиктом");
  assert.match(src, /type Role = "lead" \| "ahead"/, "«доказанный лидер» и «просто впереди» — разные состояния");
  assert.doesNotMatch(src, /variant\.id === leadId \? "lead"/, "вернулась сплошная корона независимо от вердикта");
});

test("зафиксированный победитель снимает отметку лидера по кликам", () => {
  // Если владелец выбрал не того, кто впереди по CTR, вторая корона на чужой
  // карточке спорила бы с принятым решением.
  assert.match(detail(), /const leadId = winner \? null :/);
});

test("крупным числом стоит та доля, по которой тест решается", () => {
  // У cr-теста победителя выбирают по корзинам к открытиям. Пока в шапке
  // столбца стоял CTR независимо от типа, экран показывал не ту величину.
  const src = detail();
  assert.match(src, /const heroOf = \(v: CtrVariantView\) => \(test\.testType === "ctr"/);
  assert.match(src, /const heroLabel = test\.testType === "ctr" \? "CTR"/);
  assert.match(src, /if \(test\.testType !== "ctr"\) return "neutral";/, "порог считается по кликам — на других типах цвета приговора нет");
});

test("пустая группа метрик сворачивается, а не занимает три ряда нулей", () => {
  const src = detail();
  assert.match(src, /function isEmptyGroup/);
  assert.match(src, /по нулям у всех вариантов/);
});
