import assert from "node:assert/strict";
import test from "node:test";
import { deletePayrollEmployee } from "./payrollStore.ts";

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
