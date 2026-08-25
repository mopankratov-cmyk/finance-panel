"use client";

import { displaySkuName, type WbSkuIdentity } from "./useWbSkuNames";

/**
 * Опознание товара одним блоком: артикул продавца, номер WB, название карточки.
 *
 * Раньше каждый экран рисовал своё: Полки — артикул и (если знали) название,
 * Воронка — артикул и название, а номер WB показывался ТОЛЬКО когда названия
 * не было. Получалось, что по товару нельзя опознать все три вещи сразу:
 * артикул нужен для склада, номер WB — для поиска в кабинете и в поддержке,
 * название — чтобы понять, о чём речь, не открывая карточку.
 *
 * Поэтому строки три и они всегда на месте:
 *
 *     673/бежевая
 *     WB 1224062420
 *     Куртка демисезонная оверсайз короткая
 *
 * Пустых заглушек не ставим: если названия у WB нет, третья строка просто не
 * рисуется — выдуманное «—» на её месте выглядело бы как «название пустое»,
 * хотя правда в том, что мы его не знаем.
 */
export function WbSkuIdentityCell({
  article,
  nm,
  serverName,
  directory,
  className = "",
  width = "max-w-[200px]",
}: {
  article: string | null | undefined;
  nm: number;
  /** Название, пришедшее с сервера экрана: у части кабинетов это дубль артикула. */
  serverName?: string | null;
  directory: Map<number, WbSkuIdentity>;
  className?: string;
  /** Ограничение ширины: у таблиц оно разное, поэтому задаётся снаружи. */
  width?: string;
}) {
  const code = (article ?? "").trim();
  const name = displaySkuName(code, serverName ?? null, directory, nm);
  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`${width} truncate font-semibold text-slate-800`} title={code || undefined}>
        {code || `WB ${nm}`}
      </div>
      {/* Номер WB виден всегда: по нему ищут карточку в кабинете и в поддержке. */}
      <div className={`${width} truncate text-[10px] tabular-nums text-slate-400`}>WB {nm}</div>
      {name ? (
        <div className={`${width} truncate text-[10px] text-slate-500`} title={name}>{name}</div>
      ) : null}
    </div>
  );
}
