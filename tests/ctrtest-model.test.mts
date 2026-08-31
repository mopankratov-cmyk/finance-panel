import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ctrSnapshotDelta, ctrVariantScore, normalizeCtrCreatePayload } from "../lib/ctrtest/model";
import { CTR_MIN_VIEWS } from "../lib/wb/ctrQuality";

test("CTR test creation requires one cabinet and unique HTTPS variants", () => {
  const valid = normalizeCtrCreatePayload({
    cabinetId: "00000000-0000-4000-8000-000000000001",
    nmId: 123,
    testType: "ctr",
    intervalMin: 60,
    impressionsPerRound: 350,
    targetImpressions: 1000,
    spendCapRub: 5000,
    variants: [{ imageUrl: "https://example.com/a.webp" }, { imageUrl: "https://example.com/b.webp" }],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.ok && valid.value.variants[0].isBaseline, true);
  assert.equal(normalizeCtrCreatePayload({ cabinetId: "all" }).ok, false);
  assert.equal(normalizeCtrCreatePayload({
    cabinetId: "x", nmId: 1, testType: "ctr", intervalMin: 60, impressionsPerRound: 350, targetImpressions: 1000, spendCapRub: 5000,
    variants: [{ imageUrl: "http://example.com/a" }, { imageUrl: "https://example.com/b" }],
  }).ok, false);
});

test("metric deltas fail closed when provider counters are corrected backwards", () => {
  const delta = ctrSnapshotDelta(
    { impressions: 1000, clicks: 50, spend: 500, opens: 300, carts: 30, orders: 10 },
    { impressions: 900, clicks: 55, spend: 450, opens: 330, carts: 38, orders: 12 },
  );
  assert.equal(delta.impressions, 0);
  assert.equal(delta.clicks, 5);
  assert.equal(delta.spend, 0);
  assert.equal(delta.corrected, true);
});

test("доля варианта не рисуется, пока знаменателя мало", () => {
  const variants = [
    { id: 1, position: 0, label: "A", isBaseline: true, impressions: 1000, clicks: 30, spend: 300, opens: 500, carts: 50, orders: 10, roundsCount: 1, roundsWon: 0 },
    { id: 2, position: 1, label: "B", isBaseline: false, impressions: 900, clicks: 45, spend: 350, opens: 400, carts: 32, orders: 16, roundsCount: 1, roundsWon: 1 },
  ];
  assert.equal(ctrVariantScore("ctr", variants[1]), 5);
  // Два показа и один клик — это не «CTR 50%», это отсутствие измерения.
  assert.equal(ctrVariantScore("ctr", { ...variants[1], impressions: 2, clicks: 1 }), null);
});

test("порог знаменателя стоит там, где выбирается победитель — в SQL", () => {
  // Победителя в проде выбирает transition_ctr_test, а не TypeScript. Пока
  // порог жил только здесь, он не влиял ни на что: chooseCtrWinner с ним не
  // вызывалась ниоткуда, и вариант с двумя показами выигрывал с CTR 50%.
  const helpers = readFileSync(new URL("../supabase/migrations/202608310001_ctr_score_helpers.sql", import.meta.url), "utf8");
  assert.match(helpers, /public\.ctr_denominator\(p_type, p_impressions, p_opens\) < 50 then null/);
  assert.equal(CTR_MIN_VIEWS, 50, "порог в SQL и в TypeScript обязан быть один");

  const winner = readFileSync(new URL("../supabase/migrations/202609010001_ctr_winner_participants.sql", import.meta.url), "utf8");
  // Победитель — только среди добравших порог.
  assert.match(winner, /and public\.ctr_score\(v_test\.test_type, impressions, clicks, opens, carts, orders\) is not null/);
  // Равные показы: норму добрали не все — закрыть можно только осознанно.
  assert.match(winner, /unequal exposure: the weakest shown variant has % of % target impressions/);
  // Порог считается по тем, кто крутился: иначе неоткрученный вариант
  // делал тест незакрываемым навсегда — даже с force.
  assert.match(winner, /from public\.ctr_variants where test_id = v_test\.id and rounds_count > 0;/);
  assert.match(winner, /only one variant has been shown/);
  // Конверсию меряем одной воронкой, а не заказами карточки на клики рекламы.
  assert.match(winner, /v_winner_conv := v_winner\.orders::numeric \/ v_winner\.opens;/);
  // Клик не равно покупка: победителя по CTR сверяем с базой по конверсии.
  assert.match(winner, /клик не равно покупка/);
  // Потолок расхода даёт ответ, если данных хватило, а не молчаливую паузу.
  assert.match(winner, /v_action := 'cap_finished';/);
});

test("мёртвых близнецов правила в TypeScript не осталось", () => {
  const model = readFileSync(new URL("../lib/ctrtest/model.ts", import.meta.url), "utf8");
  assert.equal(/export function chooseCtrWinner/.test(model), false);
  assert.equal(/export function ctrWinnerExplanation/.test(model), false);
});

test("страж равных показов не запирает кнопку снаружи", () => {
  // SQL требует force для досрочного закрытия. Пока отправить его было нечем,
  // «Стоп с победителем» просто не работал в штатном случае.
  const route = readFileSync(new URL("../app/api/ctrtest/[id]/action/route.ts", import.meta.url), "utf8");
  assert.match(route, /CTR_FORCE_HINT/);
  assert.match(route, /force: body\?\.force === true/);
  const page = readFileSync(new URL("../components/wb/WbCtrPage.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!force && message\.startsWith\(CTR_FORCE_HINT\)\)/);
  // Метка живёт в общем модуле, а не двумя копиями строки: разъехались бы —
  // и экран перестал бы узнавать отказ, снова заперев кнопку.
  assert.match(readFileSync(new URL("../lib/ctrtest/model.ts", import.meta.url), "utf8"), /export const CTR_FORCE_HINT/);
  assert.match(page, /await action\(actionName, variantId, explanation, true\);/);
});
