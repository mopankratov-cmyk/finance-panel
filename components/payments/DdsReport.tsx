"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { DdsCompany } from "./ddsCompanies";
import { buildDdsSummary, TECHNICAL_SECTION } from "./ddsSummary";
import { currentLocalMonth, monthRange, periodLabel, yearRange, type DdsPeriodMode } from "./ddsPeriod";
import { Card, CardContent } from "@/components/ui/Card";
import type { Payment } from "@/lib/types";
import { useDdsCategories } from "@/components/providers/FinanceProvider";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const amountColor = (n: number) => n >= 0 ? "text-emerald-700" : "text-red-600";
const formatDate = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const categoryLabel = (value: string) => value.trim() || "Без статьи";
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const SECTION_HELP: Record<string,string> = {
  "Операционная": "Деньги от основной работы: продажи, закупки, зарплата, налоги и другие текущие расходы.",
  "Финансовая": "Кредиты, погашения, проценты, вклады собственников и дивиденды.",
  "Инвестиционная": "Выдача и возврат займов, покупка и продажа долгосрочных активов.",
  "Техническая": "Переводы между своими счетами. На общий денежный результат не влияют.",
  "Прочее": "Операции, для которых пока не определён отдельный раздел.",
};
const SECTION_TITLE: Record<string,string> = {
  "Операционная": "Операционная деятельность",
  "Финансовая": "Финансовая деятельность",
  "Инвестиционная": "Инвестиционная деятельность",
  "Техническая": "Технические переводы",
  "Прочее": "Не распределено",
};
type PaymentWithCompany = Payment & { companyId?: string | null };
export type DdsReportDrilldown = { category: string; from: string; to: string; scope: string };

export function DdsReport({ payments, companies, onOpenPayments }: { payments: PaymentWithCompany[]; companies: DdsCompany[]; onOpenPayments?: (filter: DdsReportDrilldown) => void }) {
  const { customCategoryNames } = useDdsCategories();
  const initialMonth = useMemo(() => currentLocalMonth(), []);
  const [periodMode,setPeriodMode]=useState<DdsPeriodMode>("month");
  const [month,setMonth]=useState(initialMonth);
  const [year,setYear]=useState(Number(initialMonth.slice(0,4)));
  const [customFrom,setCustomFrom]=useState("");
  const [customTo,setCustomTo]=useState("");
  const [scope,setScope]=useState("all");
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [annualExpanded,setAnnualExpanded]=useState<{key:string;rowKey:string;category:string;from:string;to:string}|null>(null);
  const companyById=useMemo(()=>new Map(companies.map(company=>[company.id,company] as const)),[companies]);
  const groups=useMemo(()=>Array.from(new Set(companies.filter(company=>company.isActive).map(company=>company.groupName))).sort(),[companies]);
  const years=useMemo(()=>{
    const values=new Set([year,Number(initialMonth.slice(0,4))]);
    payments.forEach(payment=>{const value=Number(payment.date.slice(0,4));if(value>=2000&&value<=2200)values.add(value);});
    return [...values].sort((a,b)=>b-a);
  },[payments,year,initialMonth]);
  const customComplete=Boolean(customFrom&&customTo&&customFrom<=customTo);
  const range=periodMode==="month"?monthRange(month):periodMode==="year"?yearRange(year):customComplete?{from:customFrom,to:customTo}:{from:"9999-12-31",to:"0000-01-01"};
  const scopedPayments=useMemo(()=>{
    if(scope==="all")return payments;
    if(scope==="unassigned")return payments.filter(payment=>!payment.companyId);
    if(scope.startsWith("group:")){const name=scope.slice(6);return payments.filter(payment=>payment.companyId&&companyById.get(payment.companyId)?.groupName===name);}
    return payments.filter(payment=>payment.companyId===scope);
  },[payments,scope,companyById]);
  const summary=useMemo(()=>buildDdsSummary(scopedPayments,range.from||undefined,range.to||undefined,customCategoryNames),[scopedPayments,range.from,range.to,customCategoryNames]);
  const monthly=useMemo(()=>MONTHS.map((label,index)=>{
    const value=`${year}-${String(index+1).padStart(2,"0")}`;const current=monthRange(value);
    return {label,...buildDdsSummary(scopedPayments,current.from,current.to,customCategoryNames)};
  }),[scopedPayments,year,customCategoryNames]);
  const annualSections=useMemo(()=>summary.groups.map(group=>({
    section:group.section,
    rows:group.rows.map(row=>({
      category:row.category,
      months:monthly.map(monthSummary=>monthSummary.groups.find(monthGroup=>monthGroup.section===group.section)?.rows.find(monthRow=>monthRow.category===row.category)?.net ?? 0),
      total:row.net,
    })),
  })),[summary.groups,monthly]);
  const selectedPeriod=periodMode==="month" ? new Intl.DateTimeFormat("ru-RU",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)) : periodMode==="year" ? `${year} год` : customComplete?periodLabel(customFrom,customTo):"выберите обе даты";
  const hasUnassigned=summary.groups.some(group=>group.section==="Прочее");
  const openPayments=(category:string,from:string,to:string)=>onOpenPayments?.({category,from,to,scope});
  const operationsFor=(category:string,from:string,to:string)=>scopedPayments.filter(payment=>payment.status==="done"&&payment.date>=from&&payment.date<=to&&categoryLabel(payment.category)===category).sort((a,b)=>b.date.localeCompare(a.date));

  return <div className="space-y-5">
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Способ выбора периода">
        {([['month','Месяц'],['year','Год по месяцам'],['custom','С даты по дату']] as const).map(([value,label])=><button key={value} type="button" onClick={()=>{setPeriodMode(value);setAnnualExpanded(null);}} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${periodMode===value?'border-violet-600 bg-violet-600 text-white':'border-slate-300 bg-white text-slate-700'}`}>{label}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {periodMode==="month"&&<Field label="Выберите месяц"><input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="control"/></Field>}
        {periodMode==="year"&&<Field label="Выберите год"><select value={year} onChange={event=>{setYear(Number(event.target.value));setAnnualExpanded(null);}} className="control">{years.map(value=><option key={value}>{value}</option>)}</select></Field>}
        {periodMode==="custom"&&<><Field label="С даты"><input type="date" value={customFrom} onChange={event=>setCustomFrom(event.target.value)} className="control"/></Field><Field label="По дату"><input type="date" value={customTo} onChange={event=>setCustomTo(event.target.value)} className="control"/></Field></>}
        <Field label="Компания или группа"><select value={scope} onChange={event=>{setScope(event.target.value);setAnnualExpanded(null);}} className="control"><option value="all">Все компании</option><option value="unassigned">Общее по группе</option>{groups.map(group=><option key={group} value={`group:${group}`}>Группа: {group}</option>)}{companies.filter(company=>company.isActive).map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span><b className="capitalize">Период: {selectedPeriod}</b><span className="ml-2 text-slate-500">· операций: {fmt(summary.count)}</span></span><span>Чистый поток: <b className={amountColor(summary.realNet)}>{fmt(summary.realNet)} ₽</b></span></div>
      {periodMode==="custom"&&customFrom&&customTo&&customFrom>customTo&&<p role="alert" className="text-sm text-red-600">Дата начала должна быть раньше даты окончания.</p>}
    </CardContent></Card>

    <p className="text-xs text-slate-500">Переводы между своими счетами исключены из чистого потока.</p>

    {periodMode==="year"&&<Card>
      <div className="border-b px-4 py-3"><h2 className="font-semibold">{year} год: статьи по месяцам</h2><p className="mt-1 text-xs text-slate-500">Номер столбца соответствует номеру месяца; справа — сумма статьи за год. Нажмите на сумму, чтобы развернуть составляющие её платежи.</p>{hasUnassigned&&<p role="note" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><b>Не распределено:</b> «Без статьи» означает, что статья у платежа не выбрана; остальные строки этого раздела не привязаны к виду деятельности.</p>}</div>
      <div className="scroll-x"><table className="w-full min-w-[1280px] text-sm"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="sticky left-0 z-10 min-w-60 bg-slate-50 px-4 py-3 text-left">Статья</th>{MONTHS.map((name,index)=><th key={name} title={name} aria-label={`${index+1} — ${name}`} className="min-w-20 px-2 py-3 text-right">{index+1}</th>)}<th className="sticky right-0 z-10 min-w-28 bg-slate-100 px-3 py-3 text-right">Итого</th></tr></thead><tbody>{annualSections.flatMap(section=>[
        <tr key={`${section.section}:heading`}><th colSpan={14} className="bg-violet-50 px-4 py-2 text-left font-semibold text-violet-900"><span className="sticky left-4">{SECTION_TITLE[section.section]??section.section}</span></th></tr>,
        ...section.rows.flatMap(row=>{const rowKey=`${section.section}:${row.category}`;return [
          <tr key={rowKey} className="border-t border-slate-100"><td className="sticky left-0 bg-white px-4 py-3 font-medium text-slate-700">{row.category}</td>{row.months.map((value,index)=>{const monthValue=`${year}-${String(index+1).padStart(2,"0")}`,monthDates=monthRange(monthValue),detailKey=`${rowKey}:${monthValue}`;return <td key={index} className={`px-2 py-3 text-right tabular-nums ${value===0?'text-slate-300':amountColor(value)}`}>{value===0?'—':<button type="button" aria-expanded={annualExpanded?.key===detailKey} onClick={()=>setAnnualExpanded(current=>current?.key===detailKey?null:{key:detailKey,rowKey,category:row.category,from:monthDates.from,to:monthDates.to})} className="min-h-11 rounded px-1 font-medium underline decoration-dotted underline-offset-4 hover:bg-slate-100" aria-label={`Развернуть операции: ${row.category}, ${MONTHS[index]} ${year}`}>{fmt(value)}</button>}</td>})}<td className={`sticky right-0 bg-slate-50 px-3 py-3 text-right font-semibold tabular-nums ${amountColor(row.total)}`}><button type="button" aria-expanded={annualExpanded?.key===`${rowKey}:year`} onClick={()=>setAnnualExpanded(current=>current?.key===`${rowKey}:year`?null:{key:`${rowKey}:year`,rowKey,category:row.category,from:range.from,to:range.to})} className="min-h-11 rounded px-1 underline decoration-dotted underline-offset-4 hover:bg-slate-200" aria-label={`Развернуть операции: ${row.category}, ${year} год`}>{fmt(row.total)} ₽</button></td></tr>,
          annualExpanded?.rowKey===rowKey?<tr key={`${rowKey}:details`} className="border-t border-slate-100"><td colSpan={14} className="bg-slate-50 px-4 py-3"><OperationDetails payments={operationsFor(annualExpanded.category,annualExpanded.from,annualExpanded.to)} companies={companies} onOpenAll={onOpenPayments?()=>openPayments(annualExpanded.category,annualExpanded.from,annualExpanded.to):undefined}/></td></tr>:null,
        ];})
      ])}</tbody></table></div>
    </Card>}

    {summary.groups.length===0?<Card><CardContent className="py-10 text-center text-slate-500">За выбранный период операций нет.</CardContent></Card>:periodMode!=="year"&&summary.groups.map(group=><Card key={group.section} className={group.section===TECHNICAL_SECTION?"opacity-80":""}>
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{SECTION_TITLE[group.section]??group.section}</h2><b className={amountColor(group.net)}>{fmt(group.net)} ₽</b></div><p className="mt-1 text-xs text-slate-500">{SECTION_HELP[group.section]}</p>{group.section==="Прочее"&&<p role="note" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">«Без статьи» означает, что статья у платежа не выбрана. Откройте операции и назначьте правильную статью.</p>}</div>
      <div className="divide-y divide-slate-100">{group.rows.map(row=>{const key=`${group.section}:${row.category}`,isOpen=expanded.has(key);return <div key={row.category} className="px-4 py-3 sm:px-5"><div className="flex items-center justify-between gap-4"><span className="font-medium text-slate-700">{row.category}</span><button type="button" aria-expanded={isOpen} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;})} className={`min-h-11 shrink-0 rounded-lg px-3 text-right font-semibold hover:bg-slate-100 ${amountColor(row.net)}`}>{fmt(row.net)} ₽ <span aria-hidden="true" className="ml-1 text-slate-400">{isOpen?'▴':'▾'}</span></button></div>{isOpen&&<div className="mt-2 rounded-lg bg-slate-50 p-3"><OperationDetails payments={operationsFor(row.category,range.from,range.to)} companies={companies} onOpenAll={onOpenPayments?()=>openPayments(row.category,range.from,range.to):undefined}/></div>}</div>})}</div>
    </Card>)}
  </div>;
}

function OperationDetails({payments,companies,onOpenAll}:{payments:PaymentWithCompany[];companies:DdsCompany[];onOpenAll?:()=>void}) {
  const companyNames=new Map(companies.map(company=>[company.id,company.name] as const));
  const shown=payments.slice(0,10);
  return <div className="min-w-[720px] text-sm">
    <div className="mb-2 flex items-center justify-between gap-3"><b className="text-slate-700">Операций: {payments.length}</b>{onOpenAll&&<button type="button" onClick={onOpenAll} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-700 hover:bg-slate-100">Открыть в платежах</button>}</div>
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">{shown.map(payment=><div key={payment.id} className="grid grid-cols-[7rem_minmax(14rem,1fr)_10rem_9rem] items-center gap-3 px-3 py-2"><span className="text-slate-500">{formatDate(payment.date)}</span><span className="truncate" title={payment.counterparty||payment.name}>{payment.counterparty||payment.name||"Без названия"}</span><span className="truncate text-slate-500" title={payment.companyId?companyNames.get(payment.companyId):"Общее по группе"}>{payment.companyId?companyNames.get(payment.companyId)??"Компания не найдена":"Общее по группе"}</span><b className={`text-right tabular-nums ${amountColor(payment.amount)}`}>{fmt(payment.amount)} ₽</b></div>)}</div>
    {payments.length>shown.length&&<p className="mt-2 text-xs text-slate-500">Показаны первые {shown.length}. Полный список откроется в разделе «Платежи».</p>}
  </div>;
}

function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-xs text-slate-500">{label}<div className="mt-1 [&_.control]:min-h-11 [&_.control]:w-full [&_.control]:rounded-lg [&_.control]:border [&_.control]:border-slate-300 [&_.control]:bg-white [&_.control]:px-3 [&_.control]:text-base sm:[&_.control]:text-sm">{children}</div></label>}
