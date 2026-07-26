"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  Flame,
  GripVertical,
  ListFilter,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  RNP_METRIC_FIELDS,
  RNP_VIEW_PRESETS,
  parseArticleList,
  type RnpAnomalyDirection,
  type RnpDeltaMode,
  type RnpMetricField,
  type RnpViewId,
} from "@/lib/rnp/operatingMatrix";

interface MetricDefinition {
  field: string;
  label: string;
}

export interface RnpTagOption {
  id: string;
  name: string;
  color: string;
}

interface Props {
  viewId: RnpViewId;
  metricFields: RnpMetricField[];
  metrics: MetricDefinition[];
  metricsOpen: boolean;
  articleQuery: string;
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  anomalyMode: "off" | RnpAnomalyDirection;
  anomalyThreshold: number;
  anomalyCount: number;
  turnoverWindowDays: number;
  tags: RnpTagOption[];
  activeTagIds: string[];
  selectedCount: number;
  operationsAvailable: boolean;
  sortField: string;
  sortDirection: 1 | -1;
  sortOptions: ReadonlyArray<{ field: string; label: string }>;
  busy?: boolean;
  onViewChange: (viewId: Exclude<RnpViewId, "custom">) => void;
  onMetricFieldsChange: (fields: RnpMetricField[]) => void;
  onMetricsOpenChange: (open: boolean) => void;
  onArticleQueryChange: (value: string) => void;
  onShowDeltasChange: (value: boolean) => void;
  onDeltaModeChange: (value: RnpDeltaMode) => void;
  onHeatmapChange: (value: boolean) => void;
  onSparklinesChange: (value: boolean) => void;
  onAnomalyModeChange: (value: "off" | RnpAnomalyDirection) => void;
  onAnomalyThresholdChange: (value: number) => void;
  onTurnoverWindowChange: (value: number) => void;
  onSortFieldChange: (field: string) => void;
  onSortDirectionChange: (direction: 1 | -1) => void;
  onTagFilterToggle: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => Promise<boolean>;
  onBulkTag: (tagId: string) => void;
  onClearSelection: () => void;
}

const METRIC_GROUPS: Array<{ label: string; fields: RnpMetricField[] }> = [
  { label: "Основное", fields: ["orders_count", "buyout_pct", "buyouts_count", "ad_spent", "drr"] },
  { label: "Воронка", fields: ["views", "clicks", "ctr", "open_card", "cart"] },
  { label: "Экономика", fields: ["orders_sum", "buyouts_sum", "gross", "margin_pct", "money", "gmroi"] },
  { label: "Остатки", fields: ["stock", "turnover"] },
];

const UNITS: Partial<Record<RnpMetricField, string>> = {
  ctr: "%",
  buyout_pct: "%",
  margin_pct: "%",
  drr: "%",
  gmroi: "%",
  orders_sum: "₽",
  buyouts_sum: "₽",
  gross: "₽",
  ad_spent: "₽",
  money: "₽",
  turnover: "дн.",
};

const CONTROL_CLASS =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

export function RnpOperatingToolbar(props: Props) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [tagComposerOpen, setTagComposerOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#7567e8");
  const [bulkTagId, setBulkTagId] = useState("");
  const selectedSet = new Set(props.metricFields);
  const queryCount = parseArticleList(props.articleQuery).length;
  const activeView = RNP_VIEW_PRESETS.find((view) => view.id === props.viewId);

  const toggleMetric = (field: RnpMetricField) => {
    if (selectedSet.has(field)) {
      if (props.metricFields.length === 1) return;
      props.onMetricFieldsChange(props.metricFields.filter((item) => item !== field));
      return;
    }
    props.onMetricFieldsChange([...props.metricFields, field]);
  };

  const moveMetric = (field: RnpMetricField, direction: -1 | 1) => {
    const index = props.metricFields.indexOf(field);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= props.metricFields.length) return;
    const next = [...props.metricFields];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    props.onMetricFieldsChange(next);
  };

  const createTag = async () => {
    const name = tagName.trim();
    if (!name || props.busy) return;
    const created = await props.onCreateTag(name, tagColor);
    if (!created) return;
    setTagName("");
    setTagComposerOpen(false);
  };

  return (
    <div className="relative">
      <div className="grid gap-3 border-t border-slate-100 pt-3 lg:grid-cols-[auto_260px_minmax(280px,1fr)_auto]">
        <div className="relative">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">Теги</span>
          <button
            type="button"
            onClick={() => setTagsOpen((open) => !open)}
            aria-expanded={tagsOpen}
            className={`${CONTROL_CLASS} inline-flex w-full items-center gap-2`}
          >
            <Tag className="h-3.5 w-3.5 text-slate-500" />
            {props.activeTagIds.length ? `Выбрано ${props.activeTagIds.length}` : "Теги"}
            <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" />
          </button>
        </div>

        <label>
          <span className="mb-1 block text-[10px] font-medium text-slate-500">Сортировка</span>
          <span className="flex">
            <select
              value={props.sortField}
              onChange={(event) => props.onSortFieldChange(event.target.value)}
              className={`${CONTROL_CLASS} min-w-0 flex-1 rounded-r-none`}
              aria-label="Сортировка артикулов"
            >
              {props.sortOptions.map((sort) => <option key={sort.field} value={sort.field}>{sort.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => props.onSortDirectionChange(props.sortDirection === -1 ? 1 : -1)}
              className="grid h-9 w-10 place-items-center rounded-r-lg border border-l-0 border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-violet-700"
              aria-label={props.sortDirection === -1 ? "По убыванию" : "По возрастанию"}
            >
              {props.sortDirection === -1 ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          </span>
        </label>

        <label className="relative">
          <span className="mb-1 block text-[10px] font-medium text-slate-500">Поиск / список артикулов</span>
          <Search className="pointer-events-none absolute bottom-[10px] left-3 h-3.5 w-3.5 text-slate-400" />
          <input
            value={props.articleQuery}
            onChange={(event) => props.onArticleQueryChange(event.target.value)}
            placeholder="nmID / артикул — можно списком"
            title="Один — быстрый поиск; список разделяйте пробелом, запятой или переносом строки"
            className={`${CONTROL_CLASS} w-full pl-9 pr-14`}
          />
          {props.articleQuery ? (
            <button
              type="button"
              onClick={() => props.onArticleQueryChange("")}
              className="absolute bottom-1.5 right-2 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[9px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Очистить список артикулов"
            >
              {queryCount} <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <div>
          <span className="mb-1 block text-[10px] font-medium text-slate-500">Детектор аномалий</span>
          <button
            type="button"
            onClick={() => props.onAnomalyModeChange(props.anomalyMode === "off" ? "all" : "off")}
            aria-pressed={props.anomalyMode !== "off"}
            className={`${CONTROL_CLASS} inline-flex w-full items-center gap-2 ${
              props.anomalyMode !== "off" ? "border-violet-300 bg-violet-50 text-violet-700" : ""
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            Детектор аномалий
            {props.anomalyCount > 0 ? <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold">{props.anomalyCount}</span> : null}
          </button>
        </div>
      </div>

      {props.anomalyMode !== "off" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-violet-100 bg-violet-50/55 px-3 py-2">
          <span className="text-[10px] font-medium text-slate-600">Показывать</span>
          {([
            ["all", "Все аномалии"],
            ["negative", "Только риски"],
            ["positive", "Только рост"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => props.onAnomalyModeChange(value)}
              className={`h-7 rounded-md border px-2 text-[9px] font-semibold ${
                props.anomalyMode === value ? "border-violet-300 bg-white text-violet-700" : "border-transparent text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1 text-[9px] text-slate-500">
            Порог
            <input
              type="number"
              min={10}
              max={100}
              step={5}
              value={props.anomalyThreshold}
              onChange={(event) => props.onAnomalyThresholdChange(Math.max(10, Math.min(100, Number(event.target.value) || 30)))}
              className="h-7 w-14 rounded-md border border-violet-100 bg-white px-2 text-right font-semibold tabular-nums text-slate-700 outline-none"
            />
            %
          </label>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-600">
          <input
            type="checkbox"
            checked={props.showDeltas}
            onChange={(event) => props.onShowDeltasChange(event.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          Дельты
        </label>

        <div className="inline-flex h-8 rounded-lg bg-slate-100 p-0.5" aria-label="Формат дельт">
          <button
            type="button"
            disabled={!props.showDeltas}
            onClick={() => props.onDeltaModeChange("percent")}
            className={`min-w-9 rounded-md px-2 text-[10px] font-semibold ${
              props.deltaMode === "percent" && props.showDeltas ? "bg-white text-violet-700 shadow-sm" : "text-slate-400"
            }`}
          >
            %
          </button>
          <button
            type="button"
            disabled={!props.showDeltas}
            onClick={() => props.onDeltaModeChange("absolute")}
            className={`rounded-md px-2 text-[10px] font-semibold ${
              props.deltaMode === "absolute" && props.showDeltas ? "bg-white text-violet-700 shadow-sm" : "text-slate-400"
            }`}
          >
            ± цифры
          </button>
        </div>

        <div className="relative ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setViewOpen((open) => !open)}
            className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
          >
            <Eye className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-slate-400">Отображение:</span>
            <span>{activeView?.label ?? "Свой вариант"}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          <button
            type="button"
            onClick={() => setViewOpen((open) => !open)}
            className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Вид
          </button>
          <button
            type="button"
            onClick={() => props.onMetricsOpenChange(!props.metricsOpen)}
            aria-expanded={props.metricsOpen}
            className={`${CONTROL_CLASS} inline-flex items-center gap-2 border-slate-300 font-semibold text-slate-800`}
          >
            <ListFilter className="h-3.5 w-3.5" />
            Показатели {props.metricFields.length}/{RNP_METRIC_FIELDS.length}
          </button>

          {viewOpen ? (
            <div className="absolute right-36 top-11 z-50 w-[270px] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
              <div className="px-2 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Готовые представления</div>
              {RNP_VIEW_PRESETS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => {
                    props.onViewChange(view.id);
                    setViewOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-violet-50"
                >
                  <span className={`mt-0.5 grid h-4 w-4 place-items-center rounded-full border ${
                    props.viewId === view.id ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 text-transparent"
                  }`}>
                    <Check className="h-2.5 w-2.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold text-slate-700">{view.label}</span>
                    <span className="mt-0.5 block text-[9px] leading-3 text-slate-400">{view.description}</span>
                  </span>
                </button>
              ))}
              <div className="mt-1 grid grid-cols-2 gap-1 border-t border-slate-100 pt-2">
                <button
                  type="button"
                  onClick={() => props.onHeatmapChange(!props.heatmapEnabled)}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[9px] font-semibold ${
                    props.heatmapEnabled ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-500"
                  }`}
                >
                  <Flame className="h-3 w-3" /> Теплокарта
                </button>
                <button
                  type="button"
                  onClick={() => props.onSparklinesChange(!props.sparklinesEnabled)}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-[9px] font-semibold ${
                    props.sparklinesEnabled ? "bg-violet-50 text-violet-700" : "bg-slate-50 text-slate-500"
                  }`}
                >
                  <Sparkles className="h-3 w-3" /> Мини-график
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-[9px] leading-4 text-slate-400">
        Дельты — сравнение с предыдущим аналогичным периодом · окно оборачиваемости {props.turnoverWindowDays} дней
      </p>

      {tagsOpen ? (
        <div className="absolute left-0 top-[90px] z-50 w-[360px] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-800">Фильтр по тегам</span>
            <button type="button" onClick={() => setTagsOpen(false)} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100" aria-label="Закрыть теги">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.tags.map((tag) => {
              const active = props.activeTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => props.onTagFilterToggle(tag.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-semibold ${
                    active ? "border-slate-400 bg-slate-50 text-slate-800" : "border-slate-200 text-slate-500"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              );
            })}
            {!props.tags.length ? <span className="py-2 text-[10px] text-slate-400">Тегов пока нет.</span> : null}
          </div>
          {props.operationsAvailable ? (
            <>
              <button type="button" onClick={() => setTagComposerOpen((open) => !open)} className="mt-3 h-8 rounded-lg border border-dashed border-violet-300 px-3 text-[9px] font-semibold text-violet-700 hover:bg-violet-50">
                + Новый тег
              </button>
              {tagComposerOpen ? (
                <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
                  <input
                    autoFocus
                    maxLength={40}
                    value={tagName}
                    onChange={(event) => setTagName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void createTag();
                      if (event.key === "Escape") setTagComposerOpen(false);
                    }}
                    placeholder="Название тега"
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-violet-300"
                  />
                  <div className="flex items-center gap-1.5">
                    {["#7567e8", "#2563eb", "#0891b2", "#059669", "#d97706", "#e11d48", "#64748b"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Цвет ${color}`}
                        aria-pressed={tagColor === color}
                        onClick={() => setTagColor(color)}
                        className={`h-5 w-5 rounded-full border-2 ${tagColor === color ? "border-slate-800" : "border-white"}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <button
                      type="button"
                      disabled={!tagName.trim() || props.busy}
                      onClick={() => void createTag()}
                      className="ml-auto h-8 rounded-lg bg-violet-600 px-3 text-[9px] font-bold text-white disabled:opacity-40"
                    >
                      Создать
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {props.metricsOpen ? (
        <div className="absolute right-0 top-[132px] z-50 max-h-[570px] w-[330px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.2)]">
          <div className="sticky top-0 z-10 -mx-1 -mt-1 flex items-start justify-between bg-white px-1 pb-2 pt-1">
            <div>
              <h3 className="text-[10px] font-bold text-slate-800">Показатели · тяните ⠿ для порядка</h3>
              <p className="mt-0.5 text-[9px] text-slate-400">Выбрано {props.metricFields.length} из {RNP_METRIC_FIELDS.length}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => props.onMetricFieldsChange([...RNP_METRIC_FIELDS])} className="h-6 rounded px-1.5 text-[9px] font-semibold text-slate-500 hover:bg-slate-100">все</button>
              <button type="button" onClick={() => props.onViewChange("main")} className="h-6 rounded px-1.5 text-[9px] font-semibold text-slate-500 hover:bg-slate-100">сброс</button>
              <button type="button" onClick={() => props.onMetricsOpenChange(false)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100" aria-label="Закрыть показатели"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="space-y-2">
            {METRIC_GROUPS.map((group) => {
              const selectedInGroup = group.fields.filter((field) => selectedSet.has(field)).length;
              return (
                <section key={group.label}>
                  <div className="flex items-center justify-between border-t border-slate-100 py-2 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    <span>▼ {group.label}</span>
                    <span>{selectedInGroup}/{group.fields.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.fields.map((field) => {
                      const metric = props.metrics.find((item) => item.field === field);
                      if (!metric) return null;
                      const selected = selectedSet.has(field);
                      const index = props.metricFields.indexOf(field);
                      return (
                        <div key={field} className="group flex h-8 items-center gap-1 rounded-md px-1 hover:bg-slate-50">
                          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={selected} onChange={() => toggleMetric(field)} className="h-3.5 w-3.5 accent-violet-600" />
                            <span className={`truncate text-[10px] ${selected ? "font-medium text-slate-700" : "text-slate-500"}`}>{metric.label.replace(/, (₽|%|дней|шт)$/u, "")}</span>
                            <span className="ml-auto shrink-0 text-[9px] text-slate-400">{UNITS[field] ?? "шт."}</span>
                          </label>
                          {selected ? (
                            <span className="hidden gap-0.5 group-hover:flex">
                              <button type="button" disabled={index <= 0} onClick={() => moveMetric(field, -1)} className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-white disabled:opacity-20" aria-label={`Поднять ${metric.label}`}><ArrowUp className="h-2.5 w-2.5" /></button>
                              <button type="button" disabled={index >= props.metricFields.length - 1} onClick={() => moveMetric(field, 1)} className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-white disabled:opacity-20" aria-label={`Опустить ${metric.label}`}><ArrowDown className="h-2.5 w-2.5" /></button>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}

      {props.selectedCount > 0 ? (
        <div className="fixed bottom-4 left-1/2 z-[70] flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_18px_55px_rgba(15,23,42,0.22)]">
          <span className="mr-auto text-[10px] font-semibold text-slate-700">Выбрано: {props.selectedCount}</span>
          <select
            value={bulkTagId}
            disabled={props.busy || !props.tags.length}
            onChange={(event) => setBulkTagId(event.target.value)}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-semibold text-slate-600 outline-none disabled:opacity-50"
            aria-label="Назначить тег выбранным товарам"
          >
            <option value="">Выберите тег…</option>
            {props.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <button
            type="button"
            disabled={!bulkTagId || props.busy}
            onClick={() => {
              if (!bulkTagId) return;
              props.onBulkTag(bulkTagId);
              setBulkTagId("");
            }}
            className="h-8 rounded-lg bg-violet-600 px-3 text-[9px] font-bold text-white disabled:opacity-40"
          >
            Повесить тег
          </button>
          <button type="button" onClick={props.onClearSelection} className="h-8 rounded-lg px-2 text-[9px] font-semibold text-slate-500 hover:bg-slate-100">Снять выбор</button>
        </div>
      ) : null}
    </div>
  );
}
