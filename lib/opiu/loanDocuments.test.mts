import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deleteLoanDocument,
  openLoanDocument,
  saveLoanDocument,
} from "../../components/loans/loanDocuments";

test("loan document API is authenticated and only returns a short-lived signed URL", () => {
  const source = readFileSync(
    new URL("../../app/api/opiu/loan-documents/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /requireApiSession\(\["director", "finance"\]\)/);
  assert.match(source, /public: false/);
  assert.match(source, /createSignedUrl\(data\.object_path, SIGNED_URL_TTL_SECONDS\)/);
  assert.match(source, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(source, /getPublicUrl/);
});

test("loan document API removes the uploaded object when metadata cannot be saved", () => {
  const source = readFileSync(
    new URL("../../app/api/opiu/loan-documents/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(error\) \{\s*await db\.storage\.from\(BUCKET\)\.remove\(\[objectPath\]\);/);
  assert.match(source, /\.from\("finance_loan_documents"\)\s*\.delete\(\)/);
});

test("loan documents use the server API for save, open and delete", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  let openedUrl = "";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    if (!init?.method || init.method === "GET") {
      return Response.json({ ok: true, url: "https://storage.example.test/signed" });
    }
    return Response.json({ ok: true }, { status: init.method === "POST" ? 201 : 200 });
  }) as typeof fetch;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open: (url: string) => {
        openedUrl = url;
        return null;
      },
      setTimeout,
    },
  });

  try {
    const file = new File(["contract"], "loan.pdf", { type: "application/pdf" });
    await saveLoanDocument("loan-123", file, "company-1");
    assert.equal(calls[0]?.input, "/api/opiu/loan-documents");
    assert.equal(calls[0]?.init?.method, "POST");
    const form = calls[0]?.init?.body as FormData;
    assert.equal(form.get("loanId"), "loan-123");
    assert.equal(form.get("companyId"), "company-1");
    assert.equal((form.get("file") as File).name, "loan.pdf");

    assert.equal(await openLoanDocument("loan-123"), true);
    assert.equal(calls[1]?.input, "/api/opiu/loan-documents?loanId=loan-123");
    assert.equal(openedUrl, "https://storage.example.test/signed");

    await deleteLoanDocument("loan-123");
    assert.equal(calls[2]?.init?.method, "DELETE");
    assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { loanId: "loan-123" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("loan form waits for server document upload before saving the loan", () => {
  const page = readFileSync(
    new URL("../../components/loans/LoansPage.tsx", import.meta.url),
    "utf8",
  );
  const helper = readFileSync(
    new URL("../../components/loans/loanDocuments.ts", import.meta.url),
    "utf8",
  );

  assert.match(page, /if \(result\.contractFile\) \{\s*await saveLoanDocument\(loan\.id, result\.contractFile, result\.companyId\);/);
  assert.match(page, /await deleteLoanDocument\(loan\.id\);/);
  assert.match(helper, /process\.env\.NODE_ENV !== "development"/);
});

test("loan form preserves a valid zero annual rate", () => {
  const form = readFileSync(
    new URL("../../components/loans/LoanForm.tsx", import.meta.url),
    "utf8",
  );

  assert.match(form, /value=\{data\.annualRate\}/);
  assert.doesNotMatch(form, /value=\{data\.annualRate \|\| ""\}/);
});
