import assert from "node:assert/strict";
import test from "node:test";
import { deletePayrollEmployee, loadPayrollData } from "./payrollStore.ts";

test("удаление сотрудника отправляет отдельное действие с его id", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; method?: string; body?: string } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), method: init?.method, body: String(init?.body) };
    return Response.json({ ok: true });
  };

  try {
    await deletePayrollEmployee("employee-1");
    assert.deepEqual(request, {
      url: "/api/payroll",
      method: "POST",
      body: JSON.stringify({ action: "delete_employee", employeeId: "employee-1" }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ошибка безопасного запрета удаления показывается пользователю", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "Поставьте статус «Уволен»" }, { status: 409 });

  try {
    await assert.rejects(() => deletePayrollEmployee("employee-1"), /Поставьте статус «Уволен»/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ведомость открывается, если временно недоступны приватные реквизиты", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === "/api/payroll") return Response.json({ employees: [{ id: "employee-1", full_name: "Шук" }] });
    throw new TypeError("Failed to fetch");
  };

  try {
    const data = await loadPayrollData();
    assert.equal(data.employees[0]?.fullName, "Шук");
    assert.equal(data.canViewPrivate, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ошибка связи с основной ведомостью объясняется пользователю", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };

  try {
    await assert.rejects(() => loadPayrollData(), /Не удалось связаться с сервером ведомости/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
