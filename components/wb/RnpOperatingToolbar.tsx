"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Flame,
  ListFilter,
  Search,
  Settings2,
  Sparkles,
  Tag,
  TrendingUp,
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
  onTagFilterToggle: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => Promise<boolean>;
  onBulkTag: (tagId: string) => void;
  onClearSelection: () => void;
}

function ToggleButton({
  active,
  children,
  onClick,
  title,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
        active
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

export function RnpOperatingToolbar(props: Props) {
  const [tagComposerOpen, setTagComposerOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#7c3aed");
  const selectedSet = new Set(props.metricFields);
  const orderedMetrics = [
    ...props.metricFields.map((field) => props.metrics.find((metric) => metric.field === field)).filter((metric): metric is MetricDefinition => Boolean(metric)),
    ...props.metrics.filter((metric) => !selectedSet.has(metric.field as RnpMetricField)),
  ];
  const queryCount = parseArticleList(props.articleQuery).length;

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
    <section className="mb-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Рабочая матрица РНП">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700">
            <Settings2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold text-slate-800">Рабочая матрица</h2>
            <p className="truncate text-[9px] text-slate-400">
              {props.metricFields.length} метрик · сравнение с предыдущим равным периодом · окно оборачиваемости {props.turnoverWindowDays} дн.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Представления РНП">
          {RNP_VIEW_PRESETS.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={props.viewId === view.id}
              title={view.description}
              onClick={() => props.onViewChange(view.id)}
              className={`min-h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                props.viewId === view.id
                  ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                  : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
        <label className="relative min-w-[220px] flex-1 md:max-w-[360px]">
          <span className="sr-only">Артикулы или WB ID списком</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={props.articleQuery}
            onChange={(event) => props.onArticleQueryChange(event.target.value)}
            placeholder="Артикулы или WB ID — через пробел, запятую, строку"
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-16 text-[10px] text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100"
          />
          {props.articleQuery ? (
            <button
              type="button"
              onClick={() => props.onArticleQueryChange("")}
              className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded px-1.5 py-1 text-[9px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Очистить список артикулов"
            >
              {queryCount} <X className="h-3 w-3" />
            </button>
          ) : null}
        </label>

        <ToggleButton active={props.metricsOpen} onClick={() => props.onMetricsOpenChange(!props.metricsOpen)} title="Выбрать и переставить метрики">
          <ListFilter className="h-3.5 w-3.5" /> Метрики {props.metricFields.length}/{RNP_METRIC_FIELDS.length}
        </ToggleButton>
        <ToggleButton active={props.showDeltas} onClick={() => props.onShowDeltasChange(!props.showDeltas)} title="Показывать изменение к предыдущему равному периоду">
          <TrendingUp className="h-3.5 w-3.5" /> Δ период
        </ToggleButton>
        {props.showDeltas ? (
          <select
            value={props.deltaMode}
            onChange={(event) => props.onDeltaModeChange(event.target.value as RnpDeltaMode)}
            aria-label="Формат изменения"
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
          >
            <option value="percent">Δ %</option>
            <option value="absolute">Δ число</option>
          </select>
        ) : null}
        <ToggleButton active={props.heatmapEnabled} onClick={() => props.onHeatmapChange(!props.heatmapEnabled)}>
          <Flame className="h-3.5 w-3.5" /> Теплокарта
        </ToggleButton>
        <ToggleButton active={props.sparklinesEnabled} onClick={() => props.onSparklinesChange(!props.sparklinesEnabled)}>
          <Sparkles className="h-3.5 w-3.5" /> Тренд
        </ToggleButton>

        <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500">
          <Activity className="h-3.5 w-3.5 text-violet-600" />
          <span className="sr-only md:not-sr-only">Аномалии</span>
          <select
            value={props.anomalyMode}
            onChange={(event) => props.onAnomalyModeChange(event.target.value as Props["anomalyMode"])}
            className="max-w-[112px] bg-transparent text-[10px] font-semibold text-slate-700 outline-none"
            aria-label="Фильтр аномалий"
          >
            <option value="off">Выкл.</option>
            <option value="all">Все ({props.anomalyCount})</option>
            <option value="negative">Риски</option>
            <option value="positive">Рост</option>
          </select>
        </label>
        {props.anomalyMode !== "off" ? (
          <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-500">
            Порог
            <input
              type="number"
              min={10}
              max={100}
              step={5}
              value={props.anomalyThreshold}
              onChange={(event) => props.onAnomalyThresholdChange(Math.max(10, Math.min(100, Number(event.target.value) || 30)))}
              className="w-10 bg-transparent text-right font-semibold tabular-nums text-slate-700 outline-none"
              aria-label="Порог аномалии в процентах"
            />
            %
          </label>
        ) : null}

        <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500">
          Оборач.
          <select
            value={props.turnoverWindowDays}
            onChange={(event) => props.onTurnoverWindowChange(Number(event.target.value))}
            className="bg-transparent text-[10px] font-semibold text-slate-700 outline-none"
            aria-label="Окно расчёта оборачиваемости"
          >
            {[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} дн.</option>)}
          </select>
        </label>
      </div>

      {props.tags.length || props.operationsAvailable ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            <Tag className="h-3 w-3" /> Теги
          </span>
          {props.tags.map((tag) => {
            const active = props.activeTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={active}
                onClick={() => props.onTagFilterToggle(tag.id)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[9px] font-semibold transition ${
                  active ? "border-slate-400 bg-white text-slate-800 shadow-sm" : "border-slate-200 bg-white/70 text-slate-500 hover:bg-white"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            );
          })}
          {props.operationsAvailable ? (
            <button type="button" onClick={() => setTagComposerOpen((open) => !open)} aria-expanded={tagComposerOpen} className="h-7 rounded-full border border-dashed border-violet-300 px-2 text-[9px] font-semibold text-violet-700 hover:bg-violet-50">
              + новый тег
            </button>
          ) : null}
          {props.selectedCount > 0 ? (
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] font-semibold text-slate-600">Выбрано {props.selectedCount}</span>
              <select
                defaultValue=""
                disabled={props.busy || !props.tags.length}
                onChange={(event) => {
                  if (event.target.value) props.onBulkTag(event.target.value);
                  event.currentTarget.value = "";
                }}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600 outline-none disabled:opacity-50"
                aria-label="Назначить тег выбранным товарам"
              >
                <option value="">Назначить тег…</option>
                {props.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
              <button type="button" onClick={props.onClearSelection} className="h-7 rounded-md px-2 text-[9px] font-semibold text-slate-400 hover:bg-white hover:text-slate-700">
                Снять выбор
              </button>
            </div>
          ) : null}
          {tagComposerOpen ? (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-slate-200 pt-2">
              <label className="min-w-[180px] flex-1">
                <span className="sr-only">Название нового тега</span>
                <input
                  autoFocus
                  maxLength={40}
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createTag();
                    if (event.key === "Escape") setTagComposerOpen(false);
                  }}
                  placeholder="Например: контроль цены"
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <div className="flex items-center gap-1" aria-label="Цвет нового тега">
                {["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#e11d48", "#64748b"].map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Цвет ${color}`}
                    aria-pressed={tagColor === color}
                    onClick={() => setTagColor(color)}
                    className={`h-5 w-5 rounded-full border-2 transition ${tagColor === color ? "border-slate-800 ring-2 ring-white" : "border-white"}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={!tagName.trim() || props.busy}
                onClick={() => void createTag()}
                className="h-8 rounded-lg bg-violet-600 px-3 text-[9px] font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Создать
              </button>
              <button type="button" onClick={() => setTagComposerOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Отменить создание тега">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.metricsOpen ? (
        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-[10px] font-bold text-slate-800">Метрики и порядок строк</h3>
              <p className="mt-0.5 text-[9px] text-slate-400">Отметьте нужное. Стрелки меняют порядок только выбранных строк.</p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => props.onMetricFieldsChange([...RNP_METRIC_FIELDS])}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600 hover:border-violet-200 hover:text-violet-700"
              >
                Все 18
              </button>
              <button
                type="button"
                onClick={() => props.onViewChange("main")}
                className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600 hover:border-violet-200 hover:text-violet-700"
              >
                Сбросить
              </button>
              <button
                type="button"
                onClick={() => props.onMetricsOpenChange(false)}
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700"
                aria-label="Закрыть выбор метрик"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {orderedMetrics.map((metric) => {
              const field = metric.field as RnpMetricField;
              const selected = selectedSet.has(field);
              const index = props.metricFields.indexOf(field);
              return (
                <div key={field} className={`flex min-h-9 items-center gap-2 rounded-lg border px-2 ${selected ? "border-violet-200 bg-white" : "border-slate-200 bg-white/60"}`}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleMetric(field)}
                      className="h-3.5 w-3.5 accent-violet-600"
                    />
                    <span className={`truncate text-[10px] font-medium ${selected ? "text-slate-700" : "text-slate-400"}`}>{metric.label}</span>
                  </label>
                  {selected ? (
                    <span className="flex shrink-0 gap-0.5">
                      <button type="button" disabled={index <= 0} onClick={() => moveMetric(field, -1)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25" aria-label={`Поднять метрику ${metric.label}`}>
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button type="button" disabled={index >= props.metricFields.length - 1} onClick={() => moveMetric(field, 1)} className="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-25" aria-label={`Опустить метрику ${metric.label}`}>
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
