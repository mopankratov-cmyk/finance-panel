import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WAREHOUSE_LIMITS,
  approvalAppliesTo,
  buyerMayApproveDiscrepancy,
  buyerMayApproveTransfer,
  buyerMayWriteOff,
  financeNeedsApproval,
} from "../lib/auth/approvals.ts";
import { EXTERNAL_ROLES, roleCan } from "../lib/auth/permissions.ts";

/**
 * Решения владельца от 09.09.2026 — числами и границами.
 *
 * Право отвечает «вправе ли», лимит — «на сколько». Здесь проверяется
 * второе: пороги названы в рублях и процентах, и каждый из них должен
 * держать не только явное превышение, но и обход по краю.
 */

test("расхождение до тридцати тысяч и до пяти процентов закупщик закрывает сам", () => {
  const verdict = buyerMayApproveDiscrepancy({ costRub: 29_000, quantity: 4, suppliedQuantity: 100 });
  assert.equal(verdict.allowed, true);
});

test("границы включительно: ровно лимит — ещё можно", () => {
  // «Не превышает» значит «≤». Строгое сравнение отняло бы у закупщика
  // ровно тот случай, который владелец назвал разрешённым.
  const verdict = buyerMayApproveDiscrepancy({ costRub: 30_000, quantity: 5, suppliedQuantity: 100 });
  assert.equal(verdict.allowed, true);
});

test("превышен любой из двух порогов — нужна чужая подпись", () => {
  const byMoney = buyerMayApproveDiscrepancy({ costRub: 30_001, quantity: 1, suppliedQuantity: 100 });
  assert.equal(byMoney.allowed, false);
  assert.match((byMoney as { reason: string }).reason, /дороже лимита/);

  const byShare = buyerMayApproveDiscrepancy({ costRub: 100, quantity: 6, suppliedQuantity: 100 });
  assert.equal(byShare.allowed, false);
  assert.match((byShare as { reason: string }).reason, /больше лимита 5%/);
});

test("поставка без количества не проскакивает мимо процента", () => {
  // Пустой знаменатель — это не «ноль процентов», а неизвестная доля.
  const verdict = buyerMayApproveDiscrepancy({ costRub: 10, quantity: 1, suppliedQuantity: 0 });
  assert.equal(verdict.allowed, false);
  assert.match((verdict as { reason: string }).reason, /неизвестно количество/);
});

test("списание меряется и по документу, и накопительно за месяц", () => {
  assert.equal(buyerMayWriteOff({ docRub: 10_000, monthToDateRub: 0 }).allowed, true);
  assert.equal(buyerMayWriteOff({ docRub: 10_001, monthToDateRub: 0 }).allowed, false);
  // Месячный порог считает и текущий документ: иначе четыре списания по
  // девять тысяч прошли бы мимо тридцати тысяч, каждое по отдельности законное.
  assert.equal(buyerMayWriteOff({ docRub: 9_000, monthToDateRub: 27_000 }).allowed, false);
  assert.equal(buyerMayWriteOff({ docRub: 3_000, monthToDateRub: 27_000 }).allowed, true);
});

test("перемещение между юрлицами закупщик не подтверждает", () => {
  assert.equal(buyerMayApproveTransfer({ fromEntityId: "a", toEntityId: "a" }).allowed, true);
  const cross = buyerMayApproveTransfer({ fromEntityId: "a", toEntityId: "b" });
  assert.equal(cross.allowed, false);
  assert.match((cross as { reason: string }).reason, /между юрлицами/);
});

test("лимиты настраиваемые, а константа — только значения по умолчанию", () => {
  // Владелец просил сделать пороги настраиваемыми. Проверяем, что функции
  // действительно принимают чужие числа, а не читают константу внутри.
  const strict = { ...DEFAULT_WAREHOUSE_LIMITS, writeOffPerDocRub: 1_000 };
  assert.equal(buyerMayWriteOff({ docRub: 5_000, monthToDateRub: 0 }).allowed, true);
  assert.equal(buyerMayWriteOff({ docRub: 5_000, monthToDateRub: 0 }, strict).allowed, false);
  assert.deepEqual(DEFAULT_WAREHOUSE_LIMITS, {
    discrepancyRub: 30_000,
    discrepancyShare: 0.05,
    writeOffPerDocRub: 10_000,
    writeOffPerMonthRub: 30_000,
  });
});

test("любой исходящий платёж уходит на подпись независимо от суммы", () => {
  assert.equal(financeNeedsApproval({ action: "create", outgoing: true }), true);
  assert.equal(financeNeedsApproval({ action: "edit", outgoing: true }), true);
  // Входящие деньги подписи не требуют.
  assert.equal(financeNeedsApproval({ action: "create", outgoing: false }), false);
  assert.equal(financeNeedsApproval({ action: "edit", outgoing: false }), false);
});

test("правка задним числом требует подписи независимо от направления", () => {
  for (const action of ["edit-approved", "cancel", "edit-closed-period"] as const) {
    assert.equal(financeNeedsApproval({ action }), true, action);
    assert.equal(financeNeedsApproval({ action, outgoing: false }), true, action);
  }
});

test("отчёты, сверка и классификация идут без согласования", () => {
  // Ровно та ежедневная работа, ради которой роль финансиста и заведена.
  for (const action of ["classify", "reconcile", "report-sync"] as const) {
    assert.equal(financeNeedsApproval({ action }), false, action);
  }
});

test("финансист не подписывает сам, финдиректор подписывает", () => {
  assert.equal(roleCan("financier", "finance.approve"), false);
  assert.equal(roleCan("fin_director", "finance.approve"), true);
});

test("финдиректор подписывает складские корректировки, финансист их готовит", () => {
  assert.equal(roleCan("fin_director", "warehouse.approve"), true);
  assert.equal(roleCan("fin_director", "warehouse.stock.adjust"), true);
  assert.equal(roleCan("financier", "warehouse.request.create"), true);
  assert.equal(roleCan("financier", "warehouse.approve"), false);
  assert.equal(roleCan("financier", "warehouse.stock.adjust"), false);
});

test("закупщик списывает сам, но в пределах порога", () => {
  // Право есть — иначе он не смог бы списать вовсе; порог считает отдельный
  // модуль, и одно без другого будет либо запретом, либо дырой.
  assert.equal(roleCan("buyer", "warehouse.stock.adjust"), true);
  assert.equal(buyerMayWriteOff({ docRub: 50_000, monthToDateRub: 0 }).allowed, false);
});

test("внешний контур не ждёт ничьей подписи", () => {
  // Клиент распоряжается своим юрлицом сам: порядок согласований — это
  // устройство нашей компании, и переносить его на чужую нельзя.
  for (const role of EXTERNAL_ROLES) {
    assert.equal(approvalAppliesTo(role), false);
    assert.equal(roleCan(role, "limits.manage"), true, "свои лимиты он ставит сам");
  }
  for (const role of ["financier", "buyer", "wb_manager", "warehouse"] as const) {
    assert.equal(approvalAppliesTo(role), true);
  }
});

test("фулфилмент не видит ни себестоимости, ни закупок", () => {
  // Подтверждено владельцем как осознанная отмена прежней логики.
  for (const permission of ["cost.view", "cost.edit", "purchase.manage", "finance.view"] as const) {
    assert.equal(roleCan("warehouse", permission), false, permission);
  }
});
