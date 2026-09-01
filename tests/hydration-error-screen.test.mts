import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Экран ошибки гидрации на ЛЮБУЮ причину советовал проверить таблицы в
 * Supabase. Сюда чаще попадает не разработчик, а человек с планшета, у
 * которого просто нет сессии: ему предлагали чинить базу вместо кнопки
 * «Войти», и выйти из этого экрана было нечем.
 */

test("нет сессии — это «войти», а не «проверьте таблицы в Supabase»", () => {
  const layout = read("../components/AppLayout.tsx");
  assert.match(layout, /const unauthorized = \/не авторизован\|требуется вход/);
  assert.match(layout, /unauthorized \? "Нужно войти" : "Ошибка загрузки данных"/);
  assert.match(layout, /Сессия закончилась или на этом устройстве вход ещё не выполнен\./);
  // Из тупика есть выход: кнопка входа.
  assert.match(layout, /href="\/login"/);
});

test("подсказка про схему остаётся только там, где она про схему", () => {
  const layout = read("../components/AppLayout.tsx");
  assert.match(layout, /!unauthorized && schemaMissing \?/);
  assert.equal(
    /Убедитесь, что таблицы созданы в Supabase/.test(layout),
    false,
    "безусловная подсказка про схему убрана",
  );
  // Прочие сбои получают повтор, а не совет чинить базу.
  assert.match(layout, /window\.location\.reload\(\)/);
  assert.match(layout, /Повторить/);
});
