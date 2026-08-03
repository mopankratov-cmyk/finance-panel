import assert from "node:assert/strict";
import test from "node:test";
import {
  ForecastTimeoutError,
  readForecastJson,
  runForecastWithin,
} from "./forecastRequest";

test("forecast client turns a non-JSON platform timeout into a useful error", async () => {
  const response = new Response("An error occurred with your deployment", {
    status: 504,
    headers: { "content-type": "text/plain" },
  });

  await assert.rejects(
    readForecastJson(response, "Не удалось рассчитать прогноз WB"),
    /Сервер прогноза временно недоступен/,
  );
});

test("forecast client keeps a safe JSON error returned by the API", async () => {
  const response = Response.json(
    { error: "Расчёт занял слишком много времени. Повторите запрос." },
    { status: 504 },
  );

  await assert.rejects(
    readForecastJson(response, "Не удалось рассчитать прогноз WB"),
    /Расчёт занял слишком много времени/,
  );
});

test("forecast server stops work inside the platform deadline", async () => {
  await assert.rejects(
    runForecastWithin(
      () => new Promise<never>(() => {}),
      5,
    ),
    ForecastTimeoutError,
  );
});
