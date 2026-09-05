"use client";

import { useState } from "react";

import { adPost } from "./adControlApi";
import type { ConfirmRequest } from "./ConfirmAction";

/**
 * Создание кампании.
 *
 * Форма намеренно сухая и без «умных» подстановок. Это единственное действие
 * модуля, которое ничем не отменяется: метода «удалить кампанию» у WB нет, есть
 * только «завершить», и завершённая кампания остаётся в кабинете навсегда.
 * Поэтому каждое поле человек заполняет сам, а последствия перечислены прямо
 * над кнопкой, а не спрятаны в подсказку.
 */
export function AdCreateTab({
  cabinetId,
  onAsk,
  onCreated,
}: {
  cabinetId: string;
  onAsk: (request: ConfirmRequest) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [nms, setNms] = useState("");
  const [bidType, setBidType] = useState<"manual" | "unified">("manual");
  const [paymentType, setPaymentType] = useState<"cpm" | "cpc">("cpm");
  const [search, setSearch] = useState(true);
  const [shelf, setShelf] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  const parsedNms = [...new Set(
    nms.split(/[\s,;]+/).map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0),
  )];

  const placementTypes = [...(search ? ["search"] : []), ...(shelf ? ["recommendations"] : [])];
  const ready =
    name.trim().length > 0 &&
    parsedNms.length > 0 &&
    parsedNms.length <= 50 &&
    (bidType === "unified" || placementTypes.length > 0);

  return (
    <div className="max-w-2xl space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-[11px] font-semibold text-slate-500">Название кампании</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={128}
          placeholder="Например: Ветровки NV — поиск"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] focus:border-violet-500 focus:outline-none"
        />

        <label className="mt-3 block text-[11px] font-semibold text-slate-500">
          Артикулы WB <span className="font-normal text-slate-400">(до 50, через пробел или запятую)</span>
        </label>
        <textarea
          value={nms}
          onChange={(event) => setNms(event.target.value)}
          rows={3}
          placeholder="146168367 200425104"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-[12px] focus:border-violet-500 focus:outline-none"
        />
        <div className="mt-1 text-[11px] text-slate-400">
          Распознано {parsedNms.length}
          {parsedNms.length > 50 ? " — WB берёт не больше 50" : ""}. Артикулы чужих брендов сервер отклонит: в кабинете действует
          товарный контур.
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">Тип ставки</label>
            <select
              value={bidType}
              onChange={(event) => setBidType(event.target.value as "manual" | "unified")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-[12px] focus:border-violet-500 focus:outline-none"
            >
              <option value="manual">Ручная — места и ставки задаёте вы</option>
              <option value="unified">Единая — места выбирает WB</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500">Оплата</label>
            <select
              value={paymentType}
              onChange={(event) => setPaymentType(event.target.value as "cpm" | "cpc")}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-[12px] focus:border-violet-500 focus:outline-none"
            >
              <option value="cpm">За показы (CPM)</option>
              <option value="cpc">За клики (CPC)</option>
            </select>
          </div>
        </div>

        {bidType === "manual" ? (
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-slate-500">Места показа</div>
            <div className="mt-1 flex gap-3 text-[12px] text-slate-700">
              {/* Палец получает 44px и подсветку, мышь — прежнюю компактную
                  строку: без пары `lg:` блок «Места показа» раздувался вдвое
                  и на большом экране. */}
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50 lg:min-h-0 lg:gap-1.5 lg:px-0 lg:hover:bg-transparent">
                <input type="checkbox" checked={search} onChange={() => setSearch((value) => !value)} className="h-5 w-5 accent-violet-600 lg:h-3.5 lg:w-3.5" />
                Поиск
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50 lg:min-h-0 lg:gap-1.5 lg:px-0 lg:hover:bg-transparent">
                <input type="checkbox" checked={shelf} onChange={() => setShelf((value) => !value)} className="h-5 w-5 accent-violet-600 lg:h-3.5 lg:w-3.5" />
                Рекомендации
              </label>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-slate-400">
            У единой ставки места выбирает алгоритм WB — поиск, каталог, карточки и рекомендации сразу.
          </p>
        )}

        {paymentType === "cpc" ? (
          <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
            При оплате за клики WB сам ставит минимальную ставку в момент создания. Поменять её можно сразу после.
          </p>
        ) : null}

        <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
          Кампания создаётся остановленной и с нулевым бюджетом. Удалить её нельзя — только завершить, и она останется в кабинете.
          Лимит WB на создание — пять кампаний в минуту.
        </div>

        <button
          type="button"
          disabled={!ready}
          onClick={() =>
            onAsk({
              actionId: "create",
              subject: name.trim(),
              detail: `${parsedNms.length} артикулов · ${bidType === "manual" ? "ручная ставка" : "единая ставка"} · ${paymentType === "cpm" ? "за показы" : "за клики"}${bidType === "manual" ? ` · ${placementTypes.map((item) => (item === "search" ? "поиск" : "рекомендации")).join(" и ")}` : ""}`,
              run: async () => {
                const result = await adPost<{ advertId: number }>("/api/adverts/create", {
                  cabinetId,
                  name: name.trim(),
                  nms: parsedNms,
                  bidType,
                  paymentType,
                  placementTypes,
                });
                if (result.ok) {
                  setCreated(result.data?.advertId ?? null);
                  setName("");
                  setNms("");
                  onCreated();
                }
                return { ok: result.ok, error: result.error };
              },
            })
          }
          className="mt-3 min-h-10 w-full rounded-lg bg-slate-800 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Создать кампанию
        </button>
      </div>

      {created ? (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-[12px] text-emerald-800">
          Кампания {created} создана. Она стоит и без бюджета — пополните его на вкладке «Кампании» и запустите.
        </div>
      ) : null}
    </div>
  );
}
