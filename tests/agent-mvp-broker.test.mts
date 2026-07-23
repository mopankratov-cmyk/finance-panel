import assert from "node:assert/strict";
import test from "node:test";

import {
  callMvpAgent,
  isMvpAgentEnabled,
  mvpAgentRouteError,
  mvpAgentSafeError,
  resolveMvpAgentConfig,
  type MvpAgentContext,
} from "../lib/agent/mvpBroker.ts";

const env = {
  PANKSTER_AGENT_MVP_ENABLED: "1",
  PANKSTER_DEV_DIRECTOR_MODEL_BASE_URL: "https://models.example.test/v1",
  PANKSTER_DEV_DIRECTOR_MODEL_API_KEY: "test-profile-key",
  PANKSTER_DEV_DIRECTOR_MODEL_ALLOWLIST: "kimi-test,deepseek-test",
  PANKSTER_DEV_DIRECTOR_MODEL_DEFAULT: "kimi-test",
};

const context: MvpAgentContext = {
  generatedAt: "2026-07-23T00:00:00.000Z",
  totals: {
    ordersSumMonth: 1000,
    adSpendMonth: 200,
    stockMoney: 3000,
    skuCount: 1,
  },
  skus: [
    {
      article: "A-1",
      nmId: 1,
      ordersMonth: 10,
      ordersSumMonth: 1000,
      ordersToday: 1,
      ordersYesterday: 2,
      stock: 5,
      inWay: 0,
      daysLeft: 10,
      turnoverDays: 30,
      stockMoney: 3000,
      adSpend: 200,
      drr: 20,
    },
  ],
};

test("MVP agent is opt-in and uses only profile-scoped model env", () => {
  assert.equal(isMvpAgentEnabled({}), false);
  const disabled = resolveMvpAgentConfig({});
  assert.deepEqual(disabled, { enabled: false, reason: "MVP_AGENT_DISABLED" });

  const config = resolveMvpAgentConfig({
    ...env,
    ROOT_LEVEL_API_KEY: "must-not-be-used",
    ROOT_LEVEL_BOT_TOKEN: "must-not-be-used",
  });

  assert.equal(config.enabled, true);
  if (config.enabled) {
    assert.equal(config.profile, "dev-director");
    assert.equal(config.baseUrl, "https://models.example.test/v1");
    assert.equal(config.model, "kimi-test");
    assert.deepEqual(config.allowlist, ["kimi-test", "deepseek-test"]);
  }
});

test("MVP agent fails closed when model is outside profile allowlist", () => {
  const config = resolveMvpAgentConfig({
    ...env,
    PANKSTER_DEV_DIRECTOR_MODEL_DEFAULT: "not-allowed",
  });

  assert.deepEqual(config, { enabled: false, reason: "MVP_AGENT_MODEL_NOT_ALLOWLISTED" });
  assert.equal(mvpAgentSafeError(config.reason), "MVP агент: выбранная модель не входит в allowlist профиля");
});

test("MVP agent requires profile-scoped API key and base URL", () => {
  const noKey = resolveMvpAgentConfig({
    ...env,
    PANKSTER_DEV_DIRECTOR_MODEL_API_KEY: undefined,
  });
  const noBase = resolveMvpAgentConfig({
    ...env,
    PANKSTER_DEV_DIRECTOR_MODEL_BASE_URL: undefined,
  });

  assert.deepEqual(noKey, { enabled: false, reason: "MVP_AGENT_MODEL_API_KEY_MISSING" });
  assert.deepEqual(noBase, { enabled: false, reason: "MVP_AGENT_MODEL_BASE_URL_MISSING" });
});

test("MVP agent sends OpenAI-compatible request without exposing secret in audit", async () => {
  const config = resolveMvpAgentConfig(env);
  assert.equal(config.enabled, true);
  if (!config.enabled) throw new Error("config expected");

  let authHeader = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    authHeader = String((init?.headers as Record<string, string>).Authorization);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Краткий ответ" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await callMvpAgent({
    config,
    mode: "chat",
    context,
    question: "Что важно?",
    fetchImpl,
  });

  assert.equal(authHeader, ["Bearer", "test-profile-key"].join(" "));
  assert.equal(result.text, "Краткий ответ");
  assert.equal(result.audit.profile, "dev-director");
  assert.equal(result.audit.model, "kimi-test");
  assert.equal(result.audit.provider, "openai-compatible");
  assert.doesNotMatch(JSON.stringify(result.audit), /test-profile-key/);
});

test("MVP agent blocks secret-shaped prompts before provider fetch", async () => {
  const config = resolveMvpAgentConfig(env);
  assert.equal(config.enabled, true);
  if (!config.enabled) throw new Error("config expected");

  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    return new Response("{}");
  };

  await assert.rejects(
    () => callMvpAgent({
      config,
      mode: "chat",
      context,
      question: ["Bearer", "abcdefghijklmnopqrstuvwxyz123456"].join(" "),
      fetchImpl,
    }),
    (error: unknown) => {
      const mapped = mvpAgentRouteError(error);
      return mapped.status === 502 && mapped.message.includes("заблокирован");
    },
  );
  assert.equal(called, false);
});
