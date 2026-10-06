import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompareTable, compareMinWidths } from "../components/assortment/ComparePage.tsx";
import { CandidatePicker, DraftModal, ItemEditor, RemoveModal } from "../components/assortment/CollectionEditor.tsx";
import { RejectModal } from "../components/assortment/ModelPage.tsx";
import { Modal } from "../components/ui/Modal.tsx";
import { draftPartialNotice } from "../lib/assortment/collections.ts";
import { afterReload, conflictNotice } from "../lib/assortment/reload.ts";

/**
 * Ревью PR «интерфейс» (#1531): ошибка в окне, сбой повторного чтения после действия, окно «Почему отклоняем» при конфликте версии,
 * таблица сравнения на телефоне. Панелью работают с телефона и с iPad (docs/MOBILE-ADAPTATION.md) — часть проверок про разметку.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// --- #15: ошибка в окне видна всегда ---

/** Конец элемента, открытого на позиции start (считаем вложенные div: разметка окна состоит из них). */
function divEnd(html: string, start: number): number {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Где в разметке окна лежит сообщение об ошибке: внутри прокручиваемого тела или в закреплённой части. */
function alertPlacement(html: string): { alerts: number; insideScrollBody: boolean; afterBody: boolean } {
  const marker = html.indexOf("overscroll-contain"); // класс именно тела окна
  assert.ok(marker >= 0, "у окна есть прокручиваемое тело");
  const bodyStart = html.lastIndexOf("<div", marker);
  const bodyEnd = divEnd(html, bodyStart);
  const alert = html.indexOf('role="alert"');
  return { alerts: (html.match(/role="alert"/g) ?? []).length, insideScrollBody: alert > bodyStart && alert < bodyEnd, afterBody: alert >= bodyEnd };
}

const noop = () => undefined;
const modal = (props: { open?: boolean; footer?: ReactNode; error?: ReactNode }, body: ReactNode = createElement("p", null, "BODY_TEXT")) =>
  renderToStaticMarkup(createElement(Modal, { open: true, onClose: noop, title: "Окно", ...props } as ComponentProps<typeof Modal>, body));

test("Ревью #1531/15: ошибка окна лежит в закреплённой части (над кнопками), а не в начале прокручиваемого тела; без error разметка прежняя", () => {
  const footer = createElement("button", null, "FOOTER_BUTTON");
  const withError = modal({ footer, error: "Сбой записи" });
  const placement = alertPlacement(withError);
  assert.equal(placement.alerts, 1);
  assert.equal(placement.insideScrollBody, false, "в теле она уехала бы за край на телефоне, когда форма прокручена");
  assert.ok(placement.afterBody);
  assert.ok(withError.indexOf('role="alert"') < withError.indexOf("FOOTER_BUTTON"), "ошибка стоит над кнопками окна");
  assert.ok(withError.indexOf("BODY_TEXT") < withError.indexOf('role="alert"'));
  assert.match(withError, /max-h-\[30dvh\][^"]*overflow-y-auto/, "длинный ответ сервера не съедает окно: баннер ограничен по высоте");
  // Окно без панели кнопок (список кандидатов) — тоже закреплённая ошибка.
  const noFooter = modal({ error: "Сбой" });
  assert.equal(alertPlacement(noFooter).insideScrollBody, false);
  assert.ok(alertPlacement(noFooter).afterBody);
  // Обратная совместимость: другие модули зовут Modal без error — ни лишней разметки, ни role="alert".
  const plain = modal({ footer });
  assert.doesNotMatch(plain, /role="alert"/);
  assert.equal(modal({ open: false, error: "Сбой" }), "", "закрытое окно ничего не рисует");
});

const item = {
  id: "i1", referenceId: "r1", slot: 1, isReserve: false, idea: null, details: [], nextStep: null, brief: { differences: "", questions: "", season_fit: "" },
  title: "Сумка", brand: "Zara", article: null, url: "", coverUrl: null, attributes: {}, duplicateOf: null,
} as never;

test("Ревью #1531/15: все окна подборки и карточки показывают сбой действия в закреплённой части", () => {
  const error = "Сбой действия";
  const screens: Array<[string, ReactNode]> = [
    ["ItemEditor (Задание)", createElement(ItemEditor, { item, briefSupported: true, busy: false, error, onClose: noop, onSave: noop })],
    ["RemoveModal", createElement(RemoveModal, { item, replace: false, busy: false, error, onClose: noop, onConfirm: noop })],
    ["DraftModal", createElement(DraftModal, { collectionId: "c1", busy: false, error, onClose: noop, onApply: noop })],
    ["CandidatePicker", createElement(CandidatePicker, { collectionId: "c1", asReserve: false, isBags: true, busy: null, error, onClose: noop, onAdd: noop })],
    ["RejectModal", createElement(RejectModal, { open: true, busy: false, error: createElement("span", null, error), onClose: noop, onSubmit: noop })],
  ];
  for (const [name, node] of screens) {
    const html = renderToStaticMarkup(node);
    const placement = alertPlacement(html);
    assert.equal(placement.alerts, 1, `${name}: ровно одно сообщение`);
    assert.equal(placement.insideScrollBody, false, `${name}: сообщение не в прокручиваемом теле`);
    assert.match(flat(html), /Сбой действия/, name);
  }
  // Без сбоя — баннера нет.
  assert.doesNotMatch(renderToStaticMarkup(createElement(RemoveModal, { item, replace: false, busy: false, error: null, onClose: noop, onConfirm: noop })), /role="alert"/);
});

test("Ревью #1531/15: окна раздела отдают ошибку самому Modal — в начале или в конце тела баннеров не осталось", () => {
  const editor = read("components/assortment/CollectionEditor.tsx");
  assert.doesNotMatch(editor, /ModalError/, "прежний баннер внутри тела удалён");
  assert.equal((editor.match(/<Modal [^>]*error=\{error\}/g) ?? []).length, 4, "CandidatePicker, DraftModal, ItemEditor, RemoveModal");
  assert.match(read("components/assortment/ModelPage.tsx"), /<Modal open=\{open\}[^>]*error=\{error\}/);
  assert.match(read("components/assortment/AddFindingModal.tsx"), /<Modal [^>]*error=\{result \? null : error\}/);
  assert.match(read("components/assortment/AddToCollectionModal.tsx"), /<Modal [^>]*error=\{error\}/);
  assert.match(read("components/assortment/CollectionsPage.tsx"), /<Modal [^>]*footer=\{footer\} error=\{error\}/);
  for (const file of ["AddFindingModal", "AddToCollectionModal", "CollectionsPage"]) {
    assert.doesNotMatch(read(`components/assortment/${file}.tsx`), /\{error && <div className="rounded-xl border border-red-200/, `${file}: баннер в теле окна убран`);
  }
});

// --- #16: сбой повторного чтения после частичного применения черновика ---

test("Ревью #1531/16: «мягкое» перечитывание после действия не подменяет готовый экран ошибкой; начальная загрузка — как раньше", () => {
  type S = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: number };
  const ready: S = { kind: "ready", value: 1 };
  const failure: S = { kind: "error", message: "Нет связи с сервером" };
  assert.equal(afterReload<S>(ready, failure, true), ready, "сбой чтения после действия: прежний экран остаётся (тот же объект)");
  assert.deepEqual(afterReload<S>({ kind: "loading" }, failure, true), failure, "готового экрана нет — ошибка показывается");
  assert.deepEqual(afterReload<S>(ready, failure, false), failure, "не «мягкое» чтение (начальная загрузка) — как раньше");
  const fresh: S = { kind: "ready", value: 2 };
  assert.deepEqual(afterReload<S>(ready, fresh, true), fresh, "успешное чтение заменяет экран");
});

test("Ревью #1531/16: «Добавлено N из M…» — всегда; если перечитать не вышло — так и сказано и предложено обновить", () => {
  const ok = draftPartialNotice({ applied: 1, total: 3, reason: "Сервер перегружен.", refreshed: true });
  assert.equal(ok, "Добавлено 1 из 3, остальное не добавилось: Сервер перегружен. Подборка обновлена — соберите черновик заново.", "точка в конце причины не удваивается");
  const stale = draftPartialNotice({ applied: 2, total: 5, reason: "сбой", refreshed: false });
  assert.match(stale, /^Добавлено 2 из 5, остальное не добавилось: сбой\./);
  assert.match(stale, /перечитать не удалось/);
  assert.match(stale, /Обновите подборку/);
  assert.doesNotMatch(stale, /Подборка обновлена/);
});

test("Ревью #1531/16: редактор подборки — сбой перечитывания не ломает экран, сообщение живёт на странице и не зависит от окон, есть «Обновить подборку»", () => {
  const editor = read("components/assortment/CollectionEditor.tsx");
  assert.match(editor, /const load = useCallback\(async \(soft = false\): Promise<boolean>/);
  assert.match(editor, /afterReload<State>\(prev, \{ kind: "error", message \}, soft\)/, "ошибка чтения проходит через afterReload");
  assert.match(editor, /const refreshed = await load\(true\);/, "после частичного применения — мягкое перечитывание");
  assert.match(editor, /setNotice\(\{ message: draftPartialNotice\(\{ applied: progress\.applied, total: picks\.length, reason, refreshed \}\), stale: !refreshed \}\)/);
  assert.match(editor, /if \(progress\.latest\) setState\(\{ kind: "ready", collection: progress\.latest \}\)/, "уже добавленное видно, даже если перечитать нельзя");
  assert.match(editor, /Обновить подборку/);
  // Сообщение не через error: его стирает эффект «окно открылось/закрылось», и порядок «закрыть окно / перечитать / показать» был бы важен.
  assert.doesNotMatch(editor, /setError\(`Добавлено/);
  assert.doesNotMatch(editor, /await load\(\);/, "голого перечитывания (с подменой экрана ошибкой) не осталось");
});

// --- #18: окно «Почему отклоняем» при конфликте версии ---

test("Ревью #1531/18: после 409 карточка перечитывается сама — свежая версия, причина не теряется; не вышло — в окне кнопка «Обновить карточку»", () => {
  assert.deepEqual(conflictNotice(true), { message: "Карточку только что изменили — данные обновлены. Нажмите «Отклонить» ещё раз.", conflict: false });
  const failed = conflictNotice(false);
  assert.equal(failed.conflict, true, "конфликт остаётся — кнопка обновления нужна");
  assert.match(failed.message, /обновить её не получилось/);
  const page = read("components/assortment/ModelPage.tsx");
  assert.match(page, /const lastConflict = useRef\(false\)/);
  assert.match(page, /lastConflict\.current = status === 409/);
  assert.match(page, /const fresh = await load\(true\);/, "перечитывание «мягкое»: сбой не закрывает окно с введённой причиной");
  assert.match(page, /if \(conflict\) await refreshForReject\(\);/, "на 409 из окна — перечитать");
  assert.match(page, /onClick=\{\(\) => void refreshForReject\(\)\}[^>]*>Обновить карточку/, "кнопка есть внутри окна");
  // Окно с кнопкой: ошибка-узел с кнопкой внутри закреплённой части.
  const html = renderToStaticMarkup(createElement(RejectModal, {
    open: true, busy: false, onClose: noop, onSubmit: noop,
    error: createElement("div", null, createElement("span", null, "Конфликт"), createElement("button", { type: "button" }, "Обновить карточку")),
  }));
  assert.equal(alertPlacement(html).insideScrollBody, false);
  assert.match(flat(html), /Конфликт Обновить карточку/);
});

// --- #19: сравнение на телефоне ---

const models = [1, 2, 3].map((n) => ({ id: `m${n}`, title: `Сумка ${n}`, brand: "Zara", article: `A${n}`, coverUrl: null })) as never;
const rows = [{ key: "silhouette", label: "Силуэт", values: ["тоут", "хобо", "бочонок"] }];

test("Ревью #1531/19: на телефоне подписи узкие и не закреплены (sticky только с md), ширина таблицы — по тем же числам", () => {
  assert.deepEqual(compareMinWidths(3), { narrow: 96 + 3 * 200, wide: 180 + 3 * 200 });
  assert.deepEqual(compareMinWidths(2), { narrow: 496, wide: 580 });
  const html = renderToStaticMarkup(createElement(CompareTable, { models, rows, base: "/x" }));
  assert.equal((html.match(/(?<![:\w-])sticky/g) ?? []).length, 0, "закрепления без префикса нет: на 375 px оно съедало половину ширины блока");
  assert.equal((html.match(/md:sticky/g) ?? []).length, 2, "закреплены угол шапки и подписи строк — только с md");
  // Подписи: до md узкие (w-24, text-xs, p-2), с md — 180 px.
  assert.match(html, /<th class="w-24 [^"]*md:w-\[180px\]/);
  assert.match(html, /<th scope="row" class="[^"]*p-2[^"]*text-xs[^"]*md:text-sm/);
  assert.match(html, /style="--cmp-min-narrow:696px;--cmp-min-wide:780px"/);
  assert.match(html, /min-w-\[var\(--cmp-min-narrow\)\][^"]*md:min-w-\[var\(--cmp-min-wide\)\]/, "минимальная ширина таблицы — две, по ширине подписей");
  assert.doesNotMatch(html, /style="min-width/, "прежней одной ширины на 180 px не осталось");
  // Закреплённая ячейка с непрозрачным фоном (иначе сквозь неё читаются проезжающие колонки).
  assert.match(html, /bg-white[^"]*md:sticky/);
  // Содержимое то же: фото, значения.
  assert.match(flat(html), /Силуэт тоут хобо бочонок/);
});
