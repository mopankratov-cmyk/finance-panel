import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../components/wb/WbContentPage.tsx", import.meta.url), "utf8");

/**
 * Плитка каталога была ссылкой на файл в хранилище: чтобы разглядеть кадр,
 * человек уходил в новую вкладку на голый webp — без подписи, без соседних
 * кадров и без обратной дороги, кроме кнопки «назад». Теперь клик открывает
 * предпросмотр, а ссылка на оригинал живёт внутри окна.
 */

test("клик по плитке открывает окно, а не уводит в хранилище", () => {
  assert.ok(
    !/href=\{item\.url\}[\s\S]{0,120}target="_blank"/.test(page),
    "плитка снова стала ссылкой на файл — предпросмотр обойдён",
  );
  assert.match(page, /onClick=\{\(\) => onOpen\(item\)\}/, "плитка открывает предпросмотр");
  assert.match(page, /href=\{shot\.url\}/, "ссылка на оригинал осталась — внутри окна");
});

test("окно берёт живой список, а не снимок на момент открытия", () => {
  // Снимок устаревал бы под окном: файл удалили, кадр перенесли в другую
  // половину — а окно показывало бы то, чего уже нет.
  assert.match(page, /useState<\{ group: ContentGroup; key: string \} \| null>/);
  assert.match(page, /findIndex\(\(item\) => item\.key === preview\.key\)/);
  assert.ok(
    !/setPreview\(\{ list:/.test(page),
    "список кадров снова кладётся в состояние копией",
  );
});

test("окно — общий Modal, а не свой", () => {
  // Escape, ловушка фокуса и блокировка прокрутки фона уже решены там;
  // писать это заново значит написать их хуже.
  assert.match(page, /from "@\/components\/ui\/Modal"/);
  assert.match(page, /ArrowRight|ArrowLeft/, "стрелки листают кадры");
});
