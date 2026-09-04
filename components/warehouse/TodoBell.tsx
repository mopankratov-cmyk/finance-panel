"use client";

import { AlertTriangle, Bell, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WarehouseTodo } from "@/app/api/warehouse/todo/route";

/**
 * Что требует рук — в колокольчике рядом с выбором юрлица.
 *
 * Раньше дела лежали полосой под шапкой и в спокойный день печатали «Дел нет»,
 * занимая строку ровно тем, что делать нечего. Теперь строку не занимает
 * ничего: пока дел нет, колокольчик просто стоит без счётчика, а «дел нет»
 * видно, только если специально заглянуть. Сами дела никуда не делись —
 * каждое по-прежнему кликабельно и уводит туда, где его закрывают.
 *
 * Закрытие — как у переключателя кабинетов (WbCabinetSwitcher): клик вне и
 * Escape. Слушатели вешаются только пока панель открыта — так же, как в
 * PeriodRangePicker; постоянная подписка на document ради закрытой панели ни
 * к чему.
 *
 * Панель обычная, `absolute` — по вертикали она едет за кнопкой сама. А вот
 * горизонталь считается в коде, и вот почему: `right-0` увиден вживую на узком
 * экране, где тулбар переносится и колокольчик оказывается НЕ у правого края —
 * панель шириной 320 пикселей уходила левым краем за экран на 163 пикселя, и
 * текст дел обрезался. Ограничение ширины классом тут не спасает: ширину оно
 * кэпит по вьюпорту, а левый край всё равно отсчитывается от кнопки. Поэтому
 * панель прижимается к правому краю кнопки, пока помещается, и прилипает к
 * краю экрана, когда нет.
 */
export function TodoBell({
  entityId,
  refreshKey,
  visibleTabs,
  onGo,
}: {
  entityId: string;
  refreshKey: number;
  /**
   * Вкладки, доступные этой роли. Дело, которое некуда открыть, не показываем
   * и в счётчик не берём: оператору склада и внешнему селлеру часть вкладок
   * скрыта, а роут дел про роли не знает и отдаёт всё по юрлицу. Без фильтра
   * селлер видел бы дело про маркировку и попадал по нему на экран, которого
   * в его меню нет.
   *
   * Тип нарочно шире, чем `WarehouseTodo["tab"]`: страница передаёт сюда ВСЕ
   * свои вкладки, а дела ведут лишь на пять из них. Сужать набор на стороне
   * страницы значило бы держать этот список в двух местах.
   */
  visibleTabs: ReadonlySet<string>;
  onGo: (tab: WarehouseTodo["tab"]) => void;
}) {
  const [items, setItems] = useState<WarehouseTodo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const place = useCallback(() => {
    const button = buttonRef.current?.getBoundingClientRect();
    const root = rootRef.current?.getBoundingClientRect();
    if (!button || !root) return;
    const margin = 16;
    // window.innerWidth бывает нулём: так его отдаёт встроенный браузер, пока
    // окно ещё не смерили. Из нуля получалась панель отрицательной ширины,
    // поэтому берём первый вменяемый замер, а совсем без него — просто ширину
    // панели: лучше показать её как есть, чем свернуть в полоску.
    const viewport = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0) || 320 + margin * 2;
    const width = Math.min(320, viewport - margin * 2);
    // Правый край панели совпадает с правым краем кнопки, но панель не залезает
    // ни за левый край экрана, ни за правый.
    const viewportLeft = Math.min(Math.max(margin, button.right - width), viewport - margin - width);
    // Панель позиционируется от обёртки, а замеры — от окна: переводим.
    setBox({ left: viewportLeft - root.left, width });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    fetch(`/api/warehouse/todo?entity=${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => { if (!cancelled) setItems(json.data?.items ?? []); })
      // Молча: дела — подсказка, а не отчёт. Своей ошибкой они не должны
      // сообщать ни о чём поверх экрана, ради которого человек сюда пришёл.
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [entityId, refreshKey]);

  // Смена юрлица закрывает панель: за ней стоят дела уже другой компании.
  // Обновление списка (refreshKey) панель не закрывает — человек мог нажать
  // «Обновить» именно чтобы посмотреть, ушло ли дело.
  useEffect(() => setOpen(false), [entityId]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Прокрутку слушать незачем: панель `absolute` внутри обёртки и едет за
    // кнопкой сама. А вот от ширины окна зависит горизонтальный зажим.
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const shown = (items ?? []).filter((item) => visibleTabs.has(item.tab));
  const hasDanger = shown.some((item) => item.tone === "danger");
  const label = items === null
    ? "Дела склада: считаем"
    : shown.length === 0
      ? "Дела склада: дел нет"
      : `Дела склада: ${shown.length}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={buttonRef}
        onClick={() => { place(); setOpen((value) => !value); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`relative flex items-center rounded-lg border px-3 py-2 transition-colors ${
          open ? "border-slate-300 bg-slate-50 text-slate-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        <Bell className="h-4 w-4" />
        {shown.length > 0 && (
          // Счётчик одноразрядный по устройству роута: дел бывает не больше
          // шести, и два из них взаимоисключающие.
          <span
            className={`absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums text-white ${
              hasDanger ? "bg-red-500" : "bg-amber-500"
            }`}
          >
            {shown.length}
          </span>
        )}
      </button>

      {open && box && (
        // z-40, а не 80: на этом экране модалки приёмки и коррекции стоят на
        // z-50, и панель дел не должна оказаться поверх открытой формы.
        <div
          role="menu"
          aria-label="Дела склада"
          style={{ left: box.left, width: box.width }}
          className="absolute top-full z-40 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Дела</p>
            <p className="mt-0.5 text-[11px] text-slate-500">Что ждёт рук на этом складе</p>
          </div>

          {items === null ? (
            <p className="px-3 py-4 text-sm text-slate-400">Считаем дела…</p>
          ) : shown.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">Дел нет.</p>
          ) : (
            <div className="space-y-1 p-1.5">
              {shown.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); onGo(item.tab); }}
                  // Подписи длинные («237 партий приняты, но не на остатке»),
                  // поэтому текст переносится, а иконки держат shrink-0.
                  className={`flex min-h-11 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    item.tone === "danger"
                      ? "text-red-700 hover:bg-red-50"
                      : "text-amber-800 hover:bg-amber-50"
                  }`}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
