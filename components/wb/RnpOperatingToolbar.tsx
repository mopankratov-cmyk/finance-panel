"use client";

import { AlertTriangle, ArrowDown, ArrowUp, BadgeCheck, CalendarDays, Check, ChevronDown, Download, Eye, Flame, GripVertical, Info, Pencil, Search, Settings2, SlidersHorizontal, Tag, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Hint } from "@/components/ui/Hint";
import { PeriodRangePicker } from "@/components/ui/PeriodRangePicker";
import {
  RNP_METRIC_FIELDS,
  RNP_VIEW_PRESETS,
  parseArticleList,
  type RnpAnomalyDirection,
  type RnpDeltaMode,
  type RnpGranularity,
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
  compactNumbers: boolean;
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
  brand: string;
  brands: string[];
  category: string;
  categories: string[];
  busy?: boolean;
  // Шапка в духе «Рука на пульсе»: период, гранулярность, операционные фильтры.
  granularity: RnpGranularity;
  weeklyDisabledReason?: string | null;
  burnedOnly: boolean;
  burnedHiddenCount: number;
  lossOnly: boolean;
  lossCount: number;
  rangeFrom: string;
  rangeTo: string;
  rangePreset: string;
  rangePresets: ReadonlyArray<{ value: string; label: string }>;
  taxPct: number;
  deltaBaselineLabel: string;
  asOfLabel: string | null;
  downloadDisabled: boolean;
  onViewChange: (viewId: Exclude<RnpViewId, "custom">) => void;
  onMetricFieldsChange: (fields: RnpMetricField[]) => void;
  onMetricsOpenChange: (open: boolean) => void;
  onArticleQueryChange: (value: string) => void;
  onShowDeltasChange: (value: boolean) => void;
  onDeltaModeChange: (value: RnpDeltaMode) => void;
  onHeatmapChange: (value: boolean) => void;
  onSparklinesChange: (value: boolean) => void;
  onCompactNumbersChange: (value: boolean) => void;
  onAnomalyModeChange: (value: "off" | RnpAnomalyDirection) => void;
  onAnomalyThresholdChange: (value: number) => void;
  onTurnoverWindowChange: (value: number) => void;
  onSortFieldChange: (field: string) => void;
  onSortDirectionChange: (direction: 1 | -1) => void;
  onTagFilterToggle: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => Promise<boolean>;
  onBulkTag: (tagId: string) => void;
  onRenameTag: (tagId: string, name: string, color?: string) => Promise<boolean>;
  onDeleteTag: (tagId: string) => Promise<boolean>;
  onClearSelection: () => void;
  onBrandChange: (brand: string) => void;
  onCategoryChange: (category: string) => void;
  onGranularityChange: (granularity: RnpGranularity) => void;
  onBurnedOnlyChange: (value: boolean) => void;
  onLossOnlyChange: (value: boolean) => void;
  onApplyRangePreset: (value: string) => void;
  onRangeFromChange: (iso: string) => void;
  onRangeToChange: (iso: string) => void;
  onTaxPctChange: (value: number) => void;
  onDownload: () => void;
}

// Группы пикера показателей. Порядок и состав совпадают с группами таблицы.
// ВАЖНО: сюда должно попадать КАЖДОЕ поле из RNP_METRIC_FIELDS — иначе метрику
// нельзя выбрать руками, она доступна только через готовое отображение.
// Полноту сторожит тест tests/wb-rnp-metric-picker.regression.test.mts.
export const METRIC_GROUPS: Array<{ label: string; fields: RnpMetricField[] }> = [
  { label: "Основное", fields: ["orders_count", "orders_sum", "buyout_pct", "buyouts_count", "buyouts_sum", "ad_spent", "drr"] },
  { label: "Продажи и возвраты", fields: ["orders_spp_sum", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "returns_count", "returns_sum", "return_pct", "actual_buyout_pct"] },
  { label: "Цены", fields: ["avg_order_price", "seller_discount_pct", "avg_buyout_price", "final_price", "spp_pct"] },
  { label: "Воронка", fields: ["views", "clicks", "ctr", "ad_orders", "ad_orders_sum", "open_card", "cart", "wishlist", "cart_cr", "order_cr"] },
  { label: "Органика", fields: ["org_open_card", "org_orders_count", "org_cr_pct", "org_share_pct"] },
  { label: "Экономика", fields: ["cogs", "commission_rub", "acquiring_rub", "logistics_rub", "delivery_rub", "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub", "mp_cost_rub", "gross", "margin_pct", "agent_commission_rub", "tax_rub", "net_profit", "net_margin_pct", "profit_per_unit", "romi", "gmroi"] },
  { label: "Остатки", fields: ["stock", "stock_in_way_to_client", "stock_in_way_from_client", "stock_total", "turnover", "money"] },
  { label: "Отзывы", fields: ["reviews_count", "reviews_rating", "reviews_bad_share_pct"] },
  { label: "Реклама · Ручная", fields: ["ads_manual_spent", "ads_manual_views", "ads_manual_clicks", "ads_manual_orders", "ads_manual_orders_sum"] },
  { label: "Реклама · Единая", fields: ["ads_unified_spent", "ads_unified_views", "ads_unified_clicks", "ads_unified_orders", "ads_unified_orders_sum"] },
];

const PERCENT_FIELDS: RnpMetricField[] = [
  "ctr", "buyout_pct", "actual_buyout_pct", "margin_pct", "drr", "gmroi",
  "cart_cr", "order_cr", "org_cr_pct", "org_share_pct", "cancel_pct", "return_pct", "reviews_bad_share_pct",
  "seller_discount_pct", "spp_pct", "net_margin_pct", "romi", "fbs_share_pct",
];

const RUBLE_FIELDS: RnpMetricField[] = [
  "orders_sum", "orders_spp_sum", "orders_fbs_sum", "orders_fbw_sum", "buyouts_sum", "buyouts_gross_rub", "returns_sum", "ad_orders_sum",
  "ads_manual_spent", "ads_manual_orders_sum", "ads_unified_spent", "ads_unified_orders_sum",
  "avg_order_price", "avg_buyout_price", "final_price",
  "gross", "agent_commission_rub", "tax_rub", "net_profit", "profit_per_unit",
  "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "delivery_rub",
  "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub", "mp_cost_rub",
  "ad_spent", "money",
];

const UNITS: Partial<Record<RnpMetricField, string>> = {
  ...Object.fromEntries(PERCENT_FIELDS.map((field) => [field, "%"])),
  ...Object.fromEntries(RUBLE_FIELDS.map((field) => [field, "₽"])),
  turnover: "дн.",
};

// Высота полей: 44px пальцем, 36px мышью. Порог lg, а не md, — планшет в
// портрете держат в руках, там нужен палец, а не курсор.
//
// Кегль 11px оставлен только с 1024px. Глобальное правило «поле не мельче
// 16px» написано селектором `select` (специфичность 0,0,1) и проигрывает
// любому классу размера, поэтому селекты Бренд/Категория/Сортировка с
// `text-[11px]` продолжали бы масштабировать страницу в iOS Safari при
// фокусе — а обратно он её не уменьшает.
const CONTROL_CLASS =
  "h-11 rounded-lg border border-slate-200 bg-white px-3 font-medium text-slate-700 outline-none transition hover:border-slate-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 lg:h-9 lg:text-[11px]";

// Поповер, привязанный к своей кнопке, на узком экране уезжает за край
// гарантированно: кнопки шапки стоят в переносящемся ряду, левый край у них
// непредсказуем, а сами блоки шириной 240–360px шире половины телефона.
// Поэтому до 1024px это лист у нижнего края — на телефоне над нижней
// навигацией оболочки, на планшете просто у края. С 1024px, где ширины
// хватает всем, поповер остаётся поповером у своей кнопки.
const POPOVER_SHEET_BASE =
  "fixed inset-x-3 bottom-[calc(4rem+var(--safe-b))] z-50 mx-auto max-h-[62svh] max-w-md overflow-y-auto md:bottom-4 lg:absolute lg:inset-x-auto lg:bottom-auto lg:mx-0 lg:max-w-none";
const POPOVER_SHEET = `${POPOVER_SHEET_BASE} lg:max-h-none lg:overflow-visible`;

const SECTION_LABEL_CLASS = "text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400";

function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}.${month}.${year.slice(2)}` : iso;
}

// Чип-переключатель как у референса: активный — фиолетовый с галкой.
function FilterChip({ active, onClick, disabled, title, hint, icon, label, badge }: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** Пояснение, доступное и пальцем. Отключённая кнопка не показывает `title`
   *  даже мышью, а на касании его не бывает вовсе — причина запрета иначе
   *  просто пропадает. */
  hint?: string | null;
  icon?: React.ReactNode;
  label: string;
  badge?: string | number | null;
}) {
  const chip = (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-9 ${
        active ? "border-violet-600 bg-violet-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
      }`}
    >
      {active ? <Check className="h-3.5 w-3.5" /> : icon}
      {label}
      {badge != null && badge !== 0 ? (
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${active ? "bg-white/20" : "bg-violet-100 text-violet-700"}`}>{badge}</span>
      ) : null}
    </button>
  );
  if (!hint) return chip;
  return (
    <span className="inline-flex items-center gap-1">
      {chip}
      <Hint label={`Пояснение к фильтру «${label}»`}>{hint}</Hint>
    </span>
  );
}

export function RnpOperatingToolbar(props: Props) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [tagComposerOpen, setTagComposerOpen] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#7567e8");
  const [bulkTagId, setBulkTagId] = useState("");
  const selectedSet = new Set(props.metricFields);
  const queryCount = parseArticleList(props.articleQuery).length;
  const activeView = RNP_VIEW_PRESETS.find((view) => view.id === props.viewId);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const closePopovers = () => {
    setViewOpen(false);
    setSettingsOpen(false);
    setInfoOpen(false);
    setTagsOpen(false);
  };

  // Клик мимо шапки закрывает все поповеры — иначе период/теги/пикер висят,
  // пока не найдёшь их собственную кнопку. Слушатель вешается ОДИН раз:
  // актуальное замыкание живёт в ref, чтобы не пересоздавать подписку на
  // каждый рендер тяжёлой страницы.
  const closeAllRef = useRef<() => void>(() => {});
  closeAllRef.current = () => {
    closePopovers();
    if (props.metricsOpen) props.onMetricsOpenChange(false);
  };
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closeAllRef.current();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

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
    <div ref={rootRef} className="relative">
      {/* ===== ДАННЫЕ ===== */}
      <div className={SECTION_LABEL_CLASS}>Данные</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <PeriodRangePicker
          from={props.rangeFrom}
          to={props.rangeTo}
          presets={props.rangePresets}
          activePreset={props.rangePreset}
          onApplyPreset={props.onApplyRangePreset}
          onApplyRange={(from, to) => {
            props.onRangeFromChange(from);
            props.onRangeToChange(to);
          }}
        />

        <label className="relative inline-flex items-center">
          <BadgeCheck className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-violet-500" />
          <select
            value={props.brand}
            onChange={(event) => props.onBrandChange(event.target.value)}
            className={`${CONTROL_CLASS} w-[150px] appearance-none pl-9 pr-7`}
            aria-label="Бренд товара"
          >
            <option value="">Бренд: все</option>
            {props.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
        </label>

        <label className="relative inline-flex items-center">
          <select
            value={props.category}
            onChange={(event) => props.onCategoryChange(event.target.value)}
            className={`${CONTROL_CLASS} w-[160px] appearance-none pr-7`}
            aria-label="Категория"
          >
            <option value="">Категория: все</option>
            {props.categories.map((category) => <option key={category} value={category}>{category}</option>)}
            <option value="__none">Без категории</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
        </label>

        <div className="relative">
          <button
            type="button"
            onClick={() => { const open = infoOpen; closePopovers(); setInfoOpen(!open); }}
            aria-label="Как считаются данные"
            aria-expanded={infoOpen}
            className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:h-9 lg:w-9"
          >
            <Info className="h-4 w-4" />
          </button>
          {infoOpen ? (
            <div className={`${POPOVER_SHEET} rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-4 text-slate-600 shadow-[0_18px_55px_rgba(15,23,42,0.18)] lg:left-0 lg:top-11 lg:w-[300px]`}>
              <b className="text-slate-800">Как считаются данные.</b> Часовые снимки WB; остатки — актуальные WB.
              «Без сгоревших» скрывает артикулы без заказов и без остатка за период.
              «Потери» — минусовая прибыль, реклама без заказов или обнулившийся остаток при спросе.
              «Аномалии» ищутся среди артикулов, дающих 80% оборота среза: в хвосте с единичными
              заказами почти любое недельное движение превышает порог и топит сигнал.
              В гранулярности «Неделя» суммы складываются по дням, а проценты — среднее по дням с данными.
              Окно оборачиваемости — {props.turnoverWindowDays} дн.
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 lg:gap-1.5">
          <FilterChip
            active={props.burnedOnly}
            onClick={() => props.onBurnedOnlyChange(!props.burnedOnly)}
            title="Скрыть артикулы без заказов и без остатка за период"
            label="Без сгоревших"
            badge={props.burnedOnly ? props.burnedHiddenCount : null}
          />
          <FilterChip
            active={props.lossOnly}
            onClick={() => props.onLossOnlyChange(!props.lossOnly)}
            title="Только артикулы с потерями: минус по прибыли, реклама без заказов, ноль остатка при спросе"
            icon={<Flame className="h-3.5 w-3.5 text-amber-500" />}
            label="Потери"
            badge={props.lossCount}
          />
          <FilterChip
            active={props.anomalyMode !== "off"}
            onClick={() => props.onAnomalyModeChange(props.anomalyMode === "off" ? "all" : "off")}
            disabled={props.granularity === "week"}
            title={props.granularity === "week" ? "Аномалии считаются по дням — переключитесь на «День»" : "Резкие отклонения к прошлому периоду среди артикулов, дающих 80% оборота"}
            hint={props.granularity === "week" ? "Аномалии считаются по дням — переключитесь на «День»." : null}
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
            label="Аномалии"
            badge={props.anomalyCount}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative" data-tags-anchor>
        <button
          type="button"
          onClick={() => { const open = tagsOpen; closePopovers(); setTagsOpen(!open); }}
          aria-expanded={tagsOpen}
          className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
        >
          <Tag className="h-3.5 w-3.5 text-slate-500" />
          {props.activeTagIds.length ? `Тег: ${props.activeTagIds.length} выбрано` : props.tags.length ? `Тег: ${props.tags.length} тегов` : "Тег: тегов нет"}
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>
      {tagsOpen ? (
        <div className={`${POPOVER_SHEET} rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.18)] lg:left-0 lg:top-full lg:mt-1 lg:w-[360px]`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-800">Фильтр по тегам</span>
            <button type="button" onClick={() => setTagsOpen(false)} className="grid h-11 w-11 place-items-center rounded-md text-slate-400 hover:bg-slate-100 lg:h-7 lg:w-7" aria-label="Закрыть теги">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {props.tags.map((tag) => {
              const active = props.activeTagIds.includes(tag.id);
              if (editingTagId === tag.id) {
                return (
                  <span key={tag.id} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-1.5 lg:min-h-8">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <input
                      autoFocus
                      maxLength={40}
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setEditingTagId(null);
                        if (event.key === "Enter") {
                          const name = editingName.trim();
                          if (name) void props.onRenameTag(tag.id, name).then((ok) => { if (ok) setEditingTagId(null); });
                        }
                      }}
                      aria-label={`Новое название тега ${tag.name}`}
                      className="h-9 w-24 bg-transparent font-semibold text-slate-800 outline-none lg:h-6 lg:text-[9px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const name = editingName.trim();
                        if (name) void props.onRenameTag(tag.id, name).then((ok) => { if (ok) setEditingTagId(null); });
                      }}
                      className="grid h-9 w-9 place-items-center rounded-full text-violet-700 hover:bg-violet-100 lg:h-6 lg:w-6"
                      aria-label="Сохранить название"
                    >
                      ✓
                    </button>
                  </span>
                );
              }
              return (
                <span key={tag.id} className={`inline-flex min-h-11 items-center rounded-full border pl-2.5 lg:min-h-8 ${
                  active ? "border-slate-400 bg-slate-50" : "border-slate-200"
                }`}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => props.onTagFilterToggle(tag.id)}
                    className={`inline-flex items-center gap-1.5 text-[9px] font-semibold ${active ? "text-slate-800" : "text-slate-500"}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                  {props.operationsAvailable ? (
                    <span className="ml-1 inline-flex items-center pr-1">
                      <button
                        type="button"
                        onClick={() => { setEditingTagId(tag.id); setEditingName(tag.name); }}
                        className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:h-6 lg:w-6"
                        aria-label={`Переименовать тег ${tag.name}`}
                        title="Переименовать"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Удалить тег «${tag.name}»? Он снимется со всех товаров кабинета.`)) void props.onDeleteTag(tag.id);
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 lg:h-6 lg:w-6"
                        aria-label={`Удалить тег ${tag.name}`}
                        title="Удалить"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </span>
              );
            })}
            {!props.tags.length ? <span className="py-2 text-[10px] text-slate-400">Тегов пока нет.</span> : null}
          </div>
          {props.operationsAvailable ? (
            <>
              <button type="button" onClick={() => setTagComposerOpen((open) => !open)} className="mt-3 min-h-11 rounded-lg border border-dashed border-violet-300 px-3 text-[9px] font-semibold text-violet-700 hover:bg-violet-50 lg:min-h-8">
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
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 outline-none focus:border-violet-300 lg:h-8 lg:text-[10px]"
                  />
                  <div className="flex items-center gap-2 lg:gap-1.5">
                    {["#7567e8", "#2563eb", "#0891b2", "#059669", "#d97706", "#e11d48", "#64748b"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Цвет ${color}`}
                        aria-pressed={tagColor === color}
                        onClick={() => setTagColor(color)}
                        className={`h-9 w-9 rounded-full border-2 lg:h-5 lg:w-5 ${tagColor === color ? "border-slate-800" : "border-white"}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    <button
                      type="button"
                      disabled={!tagName.trim() || props.busy}
                      onClick={() => void createTag()}
                      className="ml-auto min-h-11 rounded-lg bg-violet-600 px-3 text-[9px] font-bold text-white disabled:opacity-40 lg:min-h-8"
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
        </div>

        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={props.articleQuery}
            onChange={(event) => props.onArticleQueryChange(event.target.value)}
            placeholder="nmID / артикул — можно списком"
            className={`${CONTROL_CLASS} w-full pl-9 pr-14`}
          />
          {props.articleQuery ? (
            <button
              type="button"
              onClick={() => props.onArticleQueryChange("")}
              className="tap-hit absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md px-1.5 text-[9px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Очистить список артикулов"
            >
              {queryCount} <X className="h-3 w-3" />
            </button>
          ) : (
            // Правила списка жили в `title` поля: на касании их не было вовсе.
            // Значок стоит там же, где потом появится счётчик с крестиком, —
            // одно место, два взаимоисключающих состояния.
            <Hint label="Как искать по артикулам" className="absolute right-3 top-1/2 -translate-y-1/2">
              Один артикул или nmID — быстрый поиск. Список разделяйте пробелом, запятой или переносом строки.
            </Hint>
          )}
        </label>

        <label className={`${CONTROL_CLASS} inline-flex items-center gap-2`} title="Окно оборачиваемости остатков">
          <span className="text-slate-500">Окно оборач.</span>
          <input
            type="number"
            min={1}
            max={180}
            value={props.turnoverWindowDays}
            onChange={(event) => props.onTurnoverWindowChange(Math.max(1, Math.min(180, Number(event.target.value) || 7)))}
            className="w-12 border-0 bg-transparent text-right font-semibold tabular-nums text-slate-800 outline-none"
            aria-label="Окно оборачиваемости, дней"
          />
          <span className="text-slate-500">дн</span>
        </label>
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
              className={`min-h-11 rounded-md border px-2 text-[9px] font-semibold lg:min-h-7 ${
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
              className="h-11 w-20 rounded-md border border-violet-100 bg-white px-2 text-right font-semibold tabular-nums text-slate-700 outline-none lg:h-7 lg:w-14 lg:text-[9px]"
            />
            %
          </label>
        </div>
      ) : null}

      {/* ===== ПОКАЗ ===== */}
      <div className={`mt-3 border-t border-slate-100 pt-2.5 ${SECTION_LABEL_CLASS}`}>Показ</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="inline-flex h-11 rounded-lg bg-slate-100 p-0.5 lg:h-9" aria-label="Гранулярность колонок">
          <button
            type="button"
            onClick={() => props.onGranularityChange("day")}
            className={`min-w-14 rounded-md px-2.5 text-[10px] font-semibold ${
              props.granularity === "day" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"
            }`}
          >
            День
          </button>
          <button
            type="button"
            disabled={Boolean(props.weeklyDisabledReason)}
            title={props.weeklyDisabledReason ?? "Колонки по ISO-неделям"}
            onClick={() => props.onGranularityChange("week")}
            className={`min-w-14 rounded-md px-2.5 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
              props.granularity === "week" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"
            }`}
          >
            Неделя
          </button>
        </div>

        {/* Одно состояние — один контрол: «выкл / % / ± цифры». Раньше режим был
            размазан по чипу со скачущим значком и отдельной кнопке — неочевидно. */}
        <div className="inline-flex h-11 items-center rounded-lg bg-slate-100 p-0.5 lg:h-9" role="group" aria-label="Дельты к прошлому периоду">
          <span className="px-2 text-[10px] font-semibold text-slate-500">Дельты</span>
          {([
            ["off", "выкл"],
            ["percent", "%"],
            ["absolute", "± цифры"],
          ] as const).map(([value, label]) => {
            const active = !props.showDeltas ? value === "off" : props.deltaMode === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (value === "off") {
                    props.onShowDeltasChange(false);
                    return;
                  }
                  props.onShowDeltasChange(true);
                  props.onDeltaModeChange(value);
                }}
                className={`h-[38px] min-w-11 rounded-md px-2.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:h-[30px] lg:min-w-9 ${
                  active ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <label className="relative inline-flex items-center">
          {/* Подпись внутри поля съедает 84px из 196. На узком экране, где
              кегль поднят до 16px, после неё остаётся место на пять букв —
              там смысл несёт aria-label, а не надпись. */}
          <span className="pointer-events-none absolute left-3 hidden text-[11px] font-medium text-slate-400 lg:block">Сортировка:</span>
          <select
            value={props.sortField}
            onChange={(event) => props.onSortFieldChange(event.target.value)}
            className={`${CONTROL_CLASS} w-[196px] appearance-none pl-3 pr-7 lg:pl-[84px]`}
            aria-label="Сортировка артикулов"
          >
            {props.sortOptions.map((sort) => <option key={sort.field} value={sort.field}>{sort.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
        </label>
        <button
          type="button"
          onClick={() => props.onSortDirectionChange(props.sortDirection === -1 ? 1 : -1)}
          className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-violet-700 lg:h-9 lg:w-9"
          aria-label={props.sortDirection === -1 ? "По убыванию" : "По возрастанию"}
        >
          {props.sortDirection === -1 ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </button>

        <div className="relative ml-auto flex flex-wrap items-center gap-2 lg:gap-1.5">
          <button
            type="button"
            onClick={() => { const open = viewOpen; closePopovers(); setViewOpen(!open); }}
            aria-expanded={viewOpen}
            className={`${CONTROL_CLASS} inline-flex items-center gap-2`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
            {activeView?.label ?? "Свой вариант"}
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => props.onMetricsOpenChange(!props.metricsOpen)}
            aria-expanded={props.metricsOpen}
            aria-label="Видимость показателей"
            title="Видимость показателей"
            className={`${CONTROL_CLASS} inline-flex items-center gap-1.5 font-semibold text-slate-800`}
          >
            <Eye className="h-3.5 w-3.5 text-slate-500" />
            {props.metricFields.length}/{RNP_METRIC_FIELDS.length}
          </button>

          <button
            type="button"
            onClick={() => { const open = settingsOpen; closePopovers(); setSettingsOpen(!open); }}
            aria-label="Настройки отображения"
            aria-expanded={settingsOpen}
            className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-violet-700 lg:h-9 lg:w-9"
          >
            <Settings2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={props.onDownload}
            disabled={props.downloadDisabled}
            aria-label="Скачать таблицу CSV"
            title="Скачать таблицу CSV"
            className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-violet-700 disabled:opacity-40 lg:h-9 lg:w-9"
          >
            <Download className="h-4 w-4" />
          </button>

          {viewOpen ? (
            <div className={`${POPOVER_SHEET} rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_55px_rgba(15,23,42,0.18)] lg:right-0 lg:top-11 lg:w-[270px]`}>
              <div className={`px-2 pb-1.5 pt-1 ${SECTION_LABEL_CLASS}`}>Готовые представления</div>
              {RNP_VIEW_PRESETS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => {
                    props.onViewChange(view.id);
                    setViewOpen(false);
                  }}
                  className="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-violet-50 lg:min-h-0"
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
            </div>
          ) : null}

          {settingsOpen ? (
            <div className={`${POPOVER_SHEET} rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.18)] lg:right-0 lg:top-11 lg:w-[240px]`}>
              <div className={SECTION_LABEL_CLASS}>Настройки отображения</div>
              <div className="mt-2 space-y-1">
                <ViewCheck
                  label="Теплокарта"
                  checked={props.heatmapEnabled}
                  onChange={() => props.onHeatmapChange(!props.heatmapEnabled)}
                />
                <ViewCheck
                  label="Мини-графики"
                  checked={props.sparklinesEnabled}
                  onChange={() => props.onSparklinesChange(!props.sparklinesEnabled)}
                />
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <div className={SECTION_LABEL_CLASS}>Формат чисел</div>
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => props.onCompactNumbersChange(false)}
                    className={`min-h-11 rounded-md text-[10px] font-semibold lg:min-h-8 ${!props.compactNumbers ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
                  >
                    Полный
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onCompactNumbersChange(true)}
                    className={`min-h-11 rounded-md text-[10px] font-semibold lg:min-h-8 ${props.compactNumbers ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}
                  >
                    Короткий
                  </button>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-2">
                <label className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    Налог, %
                    <Hint label="Что делает ставка налога">Ставка налога с выручки. Влияет только на чистую прибыль и чистую маржу.</Hint>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    value={props.taxPct}
                    onChange={(event) => props.onTaxPctChange(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
                    className="h-11 w-20 rounded-md border border-slate-200 bg-white px-2 text-right font-semibold tabular-nums text-slate-700 outline-none focus:border-violet-300 lg:h-8 lg:w-16"
                  />
                </label>
                <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-center text-[9px] font-semibold text-violet-700" title="Используются актуальные остатки WB">
                  Остатки: актуальные WB
                </div>
              </div>
            </div>
          ) : null}
      {props.metricsOpen ? (
        <div className={`${POPOVER_SHEET_BASE} rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.2)] lg:right-0 lg:top-11 lg:max-h-[min(70svh,560px)] lg:w-[270px]`}>
          <div className="sticky top-0 z-10 -mx-1 -mt-1 flex items-start justify-between bg-white px-1 pb-2 pt-1">
            <div>
              <h3 className="text-[10px] font-bold text-slate-800">Показатели · тяните ⠿ для порядка</h3>
              <p className="mt-0.5 text-[9px] text-slate-400">Выбрано {props.metricFields.length} из {RNP_METRIC_FIELDS.length}</p>
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => props.onMetricFieldsChange([...RNP_METRIC_FIELDS])} className="h-9 rounded px-2 text-[9px] font-semibold text-slate-500 hover:bg-slate-100 lg:h-6 lg:px-1.5">все</button>
              <button type="button" onClick={() => props.onViewChange("main")} className="h-9 rounded px-2 text-[9px] font-semibold text-slate-500 hover:bg-slate-100 lg:h-6 lg:px-1.5">сброс</button>
              <button type="button" onClick={() => props.onMetricsOpenChange(false)} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-slate-100 lg:h-6 lg:w-6" aria-label="Закрыть показатели"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="space-y-2">
            {METRIC_GROUPS.map((group) => {
              const selectedInGroup = group.fields.filter((field) => selectedSet.has(field)).length;
              return (
                <section key={group.label}>
                  <div className={`flex items-center justify-between border-t border-slate-100 py-2 ${SECTION_LABEL_CLASS}`}>
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
                        <div key={field} className="group flex h-11 items-center gap-1 rounded-md px-1 hover:bg-slate-50 lg:h-8">
                          <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" checked={selected} onChange={() => toggleMetric(field)} className="h-5 w-5 accent-violet-600 lg:h-3.5 lg:w-3.5" />
                            <span className={`truncate text-[10px] ${selected ? "font-medium text-slate-700" : "text-slate-500"}`}>{metric.label.replace(/, (₽|%|дней|шт)$/u, "")}</span>
                            <span className="ml-auto shrink-0 text-[9px] text-slate-400">{UNITS[field] ?? "шт."}</span>
                          </label>
                          {selected ? (
                            <span className="hidden shrink-0 gap-0.5 group-focus-within:flex group-hover:flex max-lg:flex pointer-coarse:flex">
                              <button type="button" disabled={index <= 0} onClick={() => moveMetric(field, -1)} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-white disabled:opacity-20 lg:h-5 lg:w-5" aria-label={`Поднять ${metric.label}`}><ArrowUp className="h-4 w-4 lg:h-2.5 lg:w-2.5" /></button>
                              <button type="button" disabled={index >= props.metricFields.length - 1} onClick={() => moveMetric(field, 1)} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-white disabled:opacity-20 lg:h-5 lg:w-5" aria-label={`Опустить ${metric.label}`}><ArrowDown className="h-4 w-4 lg:h-2.5 lg:w-2.5" /></button>
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
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[9px] leading-4 text-slate-400">
        <span>
          {props.showDeltas
            ? `Дельты — сравнение с предыдущим (аналогичным) периодом ${props.deltaBaselineLabel}`
            : "Дельты выключены"}
        </span>
        {props.asOfLabel ? <span className="tabular-nums">данные на {props.asOfLabel}</span> : null}
      </div>



      {props.selectedCount > 0 ? (
        <div className="fixed bottom-[calc(max(4rem+var(--safe-b),var(--kb-inset))+0.5rem)] left-1/2 z-40 flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_18px_55px_rgba(15,23,42,0.22)] md:bottom-[calc(var(--kb-inset)+1rem)]">
          <span className="mr-auto text-[10px] font-semibold text-slate-700">Выбрано: {props.selectedCount}</span>
          <select
            value={bulkTagId}
            disabled={props.busy || !props.tags.length}
            onChange={(event) => setBulkTagId(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-2.5 font-semibold text-slate-600 outline-none disabled:opacity-50 lg:h-8 lg:text-[9px]"
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
            className="min-h-11 rounded-lg bg-violet-600 px-3 text-[9px] font-bold text-white disabled:opacity-40 lg:min-h-8"
          >
            Повесить тег
          </button>
          <button type="button" onClick={props.onClearSelection} className="min-h-11 rounded-lg px-2 text-[9px] font-semibold text-slate-500 hover:bg-slate-100 lg:min-h-8">Снять выбор</button>
        </div>
      ) : null}
    </div>
  );
}

function ViewCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex min-h-11 w-full items-center justify-between rounded-md px-1.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 lg:min-h-8"
    >
      {label}
      <span className={`grid h-4 w-4 place-items-center rounded border ${checked ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-transparent"}`}>
        <Check className="h-2.5 w-2.5" />
      </span>
    </button>
  );
}
