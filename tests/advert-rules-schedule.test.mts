import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Плашка автоправил называет время прогона, и это единственное место, где
 * человек его видит: расписание живёт в vercel.json, куда менеджер не ходит.
 *
 * 05.09.2026 они разошлись. Крон однажды сдвинули с 7:00 UTC на 6:00, а текст
 * «Прогон раз в сутки, 10:00 по Москве» остался — плашка обещала прогон на час
 * позже, чем он был. Ошибка тихая: экран выглядит исправным, врёт только
 * содержание. Поэтому сторож сравнивает не строку со строкой, а вычисляет МСК
 * из самого расписания.
 */

const MOSCOW_OFFSET_HOURS = 3;

test("плашка автоправил называет то же время, что стоит в кроне", () => {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  const cron = vercel.crons?.find((item) => item.path.startsWith("/api/adverts/rules/run"));
  assert.ok(cron, "крон автоправил пропал из vercel.json — правила перестанут срабатывать сами");

  const [minute, hour] = cron.schedule.split(" ");
  assert.equal(minute, "0", "плашка обещает круглый час — прогон в :00");
  const moscowHour = (Number(hour) + MOSCOW_OFFSET_HOURS) % 24;
  assert.ok(Number.isInteger(moscowHour), `час крона нечитаем: ${cron.schedule}`);

  const banner = readFileSync(new URL("../components/wb/ads/AdRulesTab.tsx", import.meta.url), "utf8");
  const claimed = banner.match(/Прогон раз в сутки, (\d{1,2}):(\d{2}) по Москве/);
  assert.ok(claimed, "плашка с временем прогона исчезла из AdRulesTab");
  assert.equal(
    Number(claimed[1]),
    moscowHour,
    `плашка обещает ${claimed[1]}:${claimed[2]} МСК, а крон «${cron.schedule}» UTC даёт ${moscowHour}:00 МСК`,
  );
  assert.equal(Number(claimed[2]), 0);
});
