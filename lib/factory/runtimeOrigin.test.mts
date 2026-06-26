import assert from "node:assert/strict";
import { resolveFactoryOrigin } from "./runtimeOrigin";

const prev = process.env.BASE_URL;

try {
  delete process.env.BASE_URL;
  assert.equal(resolveFactoryOrigin("https://preview.example.com/"), "https://preview.example.com");

  process.env.BASE_URL = "https://finance-panel-two.vercel.app/";
  assert.equal(resolveFactoryOrigin("https://preview.example.com"), "https://finance-panel-two.vercel.app");

  process.env.BASE_URL = "";
  assert.equal(resolveFactoryOrigin("https://preview.example.com///"), "https://preview.example.com");

  console.log("runtimeOrigin: 3 passed, 0 failed");
} finally {
  if (prev == null) delete process.env.BASE_URL;
  else process.env.BASE_URL = prev;
}
