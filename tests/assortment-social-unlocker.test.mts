import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_UNLOCKER_ZONE, DEFERRED_ERROR_CODE, googleSearchUrl, isAllowedUnlockerUrl, isDeferredRejection, unlockerConfig, unlockerFetch, UnlockerStopError, UnlockerUrlError,
  type UnlockerResult,
} from "../lib/assortment/brightdataUnlocker.ts";

/**
 * Клиент Bright Data Web Unlocker для «Залетает»: белый список адресов и разбор ответов /request по живым ответам 06.10
 * (tests/fixtures/assortment-social/responses.json): сбой цели приходит HTTP 200 с пустым телом и заголовками x-brd-*.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/assortment-social");
const index = JSON.parse(readFileSync(join(fixtures, "responses.json"), "utf8")) as Record<string, {
  target: string; request: { url: string; data_format: string }; httpStatus: number; contentType: string | null; brd: { statusCode: string | null; error: string | null; errorCode: string | null };
}>;
const config = { token: "test-token", zone: "test_zone" };

/** Подставной fetch: отвечает как /request в образце (статус, заголовки x-brd-*, тело файла). */
function replay(name: string, calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = []): typeof fetch {
  const meta = index[name];
  return (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    const headers = new Headers();
    if (meta.contentType) headers.set("content-type", meta.contentType);
    if (meta.brd.statusCode) headers.set("x-brd-status-code", meta.brd.statusCode);
    if (meta.brd.error) headers.set("x-brd-error", meta.brd.error);
    if (meta.brd.errorCode) headers.set("x-brd-error-code", meta.brd.errorCode);
    return new Response(readFileSync(join(fixtures, name), "utf8"), { status: meta.httpStatus, headers });
  }) as unknown as typeof fetch;
}

function status(code: number, body: string, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status: code, headers })) as unknown as typeof fetch;
}

test("Белый список: темы, рилсы, посты и профили Instagram, Google, карточка Zara US по p-коду, карточка Uniqlo es/uk/us; остальное — отказ", () => {
  const allowed = [
    "https://www.instagram.com/popular/zara-viral-jacket/", "https://www.instagram.com/popular/zara-красная-куртка/", "https://www.instagram.com/reel/Dd4Is8To7B0/",
    "https://www.instagram.com/p/Dd08gHjCN0c/", "https://www.instagram.com/jpnbrands/", "https://www.instagram.com/by.annamirabelle/",
    "https://www.google.com/search?q=site%3Ainstagram.com%2Freel+zara&hl=en&brd_json=1", "https://www.zara.com/us/en/x-p05854722.html",
    "https://www.uniqlo.com/es/en/products/E487882-000/00", "https://www.uniqlo.com/uk/en/products/E487882-000/00", "https://www.uniqlo.com/us/en/products/E487882-000/00",
  ];
  for (const url of allowed) assert.equal(isAllowedUnlockerUrl(url), true, url);
  const denied = [
    "http://www.instagram.com/reel/Dd4Is8To7B0/", "https://www.instagram.com/accounts/login/", "https://www.instagram.com/explore/tags/zarajacket/",
    "https://www.instagram.com/stories/x/1/", "https://scontent.cdninstagram.com/v/t51/x.jpg", "https://www.zara.com/us/en/woman-jackets-l1114.html",
    "https://www.zara.com/es/es/x-p05854722.html", "https://www.uniqlo.com/es/en/women/outerwear", "https://www.mango.com/", "https://www.google.com/maps",
    "https://user:pass@www.instagram.com/reel/Dd4Is8To7B0/", "https://www.instagram.com:8443/reel/Dd4Is8To7B0/", "not a url", "https://www.wildberries.ru/",
  ];
  for (const url of denied) assert.equal(isAllowedUnlockerUrl(url), false, url);
});

test("Адрес вне списка и запрос без ключа не уходят в сеть", async () => {
  let called = 0;
  const spy = (async () => {
    called += 1;
    return new Response("x");
  }) as unknown as typeof fetch;
  await assert.rejects(unlockerFetch("https://www.mango.com/", "markdown", { config, fetchImpl: spy }), UnlockerUrlError);
  await assert.rejects(unlockerFetch("https://www.instagram.com/jpnbrands/", "markdown", { config: { token: null, zone: "z" }, fetchImpl: spy }), (e: unknown) => e instanceof UnlockerStopError && e.code === "config");
  assert.equal(called, 0);
});

test("Запрос: POST /request с ключом, зоной, format raw и markdown / parsed_light; страница — ok", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const r = await unlockerFetch("https://www.instagram.com/reel/Dd4Is8To7B0/", "markdown", { config, fetchImpl: replay("reel-desktop-likes-visible.md", calls) });
  assert.equal(r.ok, true);
  assert.match((r as Extract<UnlockerResult, { ok: true }>).body, /Never miss a post from by\.annamirabelle/);
  assert.equal(calls[0].url, "https://api.brightdata.com/request");
  assert.deepEqual(calls[0].body, { url: "https://www.instagram.com/reel/Dd4Is8To7B0/", zone: "test_zone", format: "raw", data_format: "markdown" });
  assert.equal(calls[0].auth, "Bearer test-token");
  const g = await unlockerFetch(index["google-reel-uniqlo-jacket-gl-us.json"].request.url.replace(/&brd_json=1$/, "&brd_json=1"), "parsed_light", { config, fetchImpl: replay("google-reel-uniqlo-jacket-gl-us.json", calls) });
  assert.equal(g.ok, true);
  assert.equal(calls[1].body.data_format, "parsed_light");
});

test("HTTP 200 с пустым телом и x-brd-error-code (proxy_timeout, капча) — временный сбой, а не пустая страница", async () => {
  const timeout = await unlockerFetch("https://www.instagram.com/reel/DdVk7eRtLMC/", "markdown", { config, fetchImpl: replay("error-proxy-timeout-empty.md") });
  assert.deepEqual([timeout.ok, !timeout.ok && timeout.kind], [false, "transient"]);
  assert.match(!timeout.ok ? timeout.reason : "", /proxy_timeout/);
  const captcha = await unlockerFetch("https://www.google.com/search?q=x&brd_json=1", "parsed_light", { config, fetchImpl: replay("error-google-captcha-empty.json") });
  assert.deepEqual([captcha.ok, !captcha.ok && captcha.kind], [false, "transient"]);
  const empty = await unlockerFetch("https://www.instagram.com/jpnbrands/", "markdown", { config, fetchImpl: status(200, "  ") });
  assert.deepEqual([empty.ok, !empty.ok && empty.kind], [false, "transient"], "пустое тело без заголовков — тоже сбой");
});

test("«This query recently failed» (failed_query_rejected, первый живой прогон 07.10, Google) — не сбой страницы, а «отложено»: повторим следующим прогоном", async () => {
  const url = "https://www.google.com/search?q=site%3Ainstagram.com%2Freel+zara+reference+jacket&hl=en&num=20&gl=us&brd_json=1";
  const why = "This query recently failed and cannot be attempted at this time. Please try again later";
  const header = await unlockerFetch(url, "parsed_light", { config, fetchImpl: status(200, "", { "x-brd-error-code": DEFERRED_ERROR_CODE, "x-brd-error": why }) });
  assert.deepEqual([header.ok, !header.ok && header.kind, !header.ok && header.deferred], [false, "transient", true]);
  assert.match(!header.ok ? header.reason : "", /^отложено Bright Data: failed_query_rejected \(This query recently failed/);
  const body = await unlockerFetch(url, "parsed_light", { config, fetchImpl: status(400, why) });
  assert.deepEqual([body.ok, !body.ok && body.kind, !body.ok && body.deferred], [false, "transient", true], "тот же отказ телом 400 — тоже «отложено», а не «страницы нет»");
  const timeout = await unlockerFetch(url, "parsed_light", { config, fetchImpl: replay("error-google-captcha-empty.json") });
  assert.equal(!timeout.ok && timeout.deferred, undefined, "капча — обычный временный сбой");
  assert.equal(isDeferredRejection("FAILED_QUERY_REJECTED"), true);
  assert.equal(isDeferredRejection("proxy_timeout", "timeout"), false);
});

test("Неверная зона (400 «zone … not found») — ошибка настройки: прогон стоп", async () => {
  await assert.rejects(
    unlockerFetch("https://www.instagram.com/jpnbrands/", "markdown", { config, fetchImpl: replay("error-bad-zone.md") }),
    (e: unknown) => e instanceof UnlockerStopError && e.code === "config" && /BRIGHTDATA_UNLOCKER_ZONE/.test(e.message),
  );
});

test("402 и «Customer is not active» — деньги: стоп прогона одной причиной; 401/403 — ключ", async () => {
  const url = "https://www.instagram.com/jpnbrands/";
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(402, "Payment required") }), (e: unknown) => e instanceof UnlockerStopError && e.code === "billing");
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(402, "") }), (e: unknown) => e instanceof UnlockerStopError && e.code === "billing", "402 без текста — тоже деньги");
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(400, "Customer is not active") }), (e: unknown) => e instanceof UnlockerStopError && e.code === "billing");
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(200, "", { "x-brd-error-code": "customer_disabled", "x-brd-error": "Customer is not active" }) }), (e: unknown) => e instanceof UnlockerStopError && e.code === "billing");
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(401, "bad token") }), (e: unknown) => e instanceof UnlockerStopError && e.code === "auth");
  await assert.rejects(unlockerFetch(url, "markdown", { config, fetchImpl: status(403, "forbidden") }), (e: unknown) => e instanceof UnlockerStopError && e.code === "auth");
});

test("429, 5xx, таймаут и обрыв — временный сбой этой страницы; 404 цели — «страницы нет»", async () => {
  const url = "https://www.instagram.com/reel/Dd4Is8To7B0/";
  for (const code of [429, 500, 502, 503]) {
    const r = await unlockerFetch(url, "markdown", { config, fetchImpl: status(code, "busy") });
    assert.deepEqual([r.ok, !r.ok && r.kind], [false, "transient"], String(code));
  }
  const timeout = await unlockerFetch(url, "markdown", { config, fetchImpl: (async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); }) as unknown as typeof fetch });
  assert.deepEqual([timeout.ok, !timeout.ok && timeout.reason], [false, "таймаут запроса"]);
  const net = await unlockerFetch(url, "markdown", { config, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  assert.deepEqual([net.ok, !net.ok && net.kind], [false, "transient"]);
  const gone = await unlockerFetch(url, "markdown", { config, fetchImpl: status(200, "Not found page", { "x-brd-status-code": "404" }) });
  assert.deepEqual([gone.ok, !gone.ok && gone.kind], [false, "failed"]);
  const bad = await unlockerFetch(url, "markdown", { config, fetchImpl: status(422, "unprocessable") });
  assert.deepEqual([bad.ok, !bad.ok && bad.kind], [false, "failed"]);
});

test("Окружение: ключ и зона (по умолчанию mcp_unlocker); адрес Google — с gl, hl, num и brd_json", () => {
  assert.deepEqual(unlockerConfig({}), { token: null, zone: DEFAULT_UNLOCKER_ZONE });
  assert.equal(DEFAULT_UNLOCKER_ZONE, "mcp_unlocker");
  assert.deepEqual(unlockerConfig({ BRIGHTDATA_API_TOKEN: " t ", BRIGHTDATA_UNLOCKER_ZONE: " social_zone " }), { token: "t", zone: "social_zone" });
  const url = googleSearchUrl("site:instagram.com/reel zara ref after:2026-09-29");
  assert.ok(url.startsWith("https://www.google.com/search?q=site%3Ainstagram.com%2Freel+zara+ref+after%3A2026-09-29&"));
  assert.match(url, /&hl=en&num=20&gl=us&brd_json=1$/);
  assert.equal(isAllowedUnlockerUrl(url), true);
});

test("Анлокер живёт отдельно: в клиенте готовых наборов (brightdata.ts) его по-прежнему нет", () => {
  const datasets = readFileSync(join(root, "lib/assortment/brightdata.ts"), "utf8");
  assert.doesNotMatch(datasets, /unlocker|zone=|\/request\b/i);
  const unlocker = readFileSync(join(root, "lib/assortment/brightdataUnlocker.ts"), "utf8");
  assert.match(unlocker, /isAllowedUnlockerUrl\(url\)/, "каждый запрос проходит белый список");
});
