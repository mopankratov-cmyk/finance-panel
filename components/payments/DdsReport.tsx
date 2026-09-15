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
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const SECTION_HELP: Record<string,string> = {
  "Операционная": "Деньги от основной работы: продажи, закупки, зарплата, налоги и другие текущие расходы.",
  "Финансовая": "Кредиты, погашения, проценты, вклады собственников и дивиденды.",
  "Инвестиционная": "Выдача и возврат займов, покупка и продажа долгосрочных активов.",
  "Техническая": "Переводы между своими счетами. На общий денежный результат не влияют.",
  "Прочее": "Операции, для которых пока не определён отдельный раздел.",
};
type PaymentWithCompany = Payment & { companyId?: string | null };

export function DdsReport({ payments, companies }: { payments: PaymentWithCompany[]; companies: DdsCompany[] }) {
  const { customCategoryNames } = useDdsCategories();
  const initialMonth = useMemo(() => currentLocalMonth(), []);
  const [periodMode,setPeriodMode]=useState<DdsPeriodMode>("month");
  const [month,setMonth]=useState(initialMonth);
  const [year,setYear]=useState(Number(initialMonth.slice(0,4)));
  const [customFrom,setCustomFrom]=useState("");
  const [customTo,setCustomTo]=useState("");
  const [scope,setScope]=useState("all");
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
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

  return <div className="space-y-5">
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Способ выбора периода">
        {([['month','Месяц'],['year','Год по месяцам'],['custom','С даты по дату']] as const).map(([value,label])=><button key={value} type="button" onClick={()=>setPeriodMode(value)} className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${periodMode===value?'border-violet-600 bg-violet-600 text-white':'border-slate-300 bg-white text-slate-700'}`}>{label}</button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {periodMode==="month"&&<Field label="Выберите месяц"><input type="month" value={month} onChange={event=>setMonth(event.target.value)} className="control"/></Field>}
        {periodMode==="year"&&<Field label="Выберите год"><select value={year} onChange={event=>setYear(Number(event.target.value))} className="control">{years.map(value=><option key={value}>{value}</option>)}</select></Field>}
        {periodMode==="custom"&&<><Field label="С даты"><input type="date" value={customFrom} onChange={event=>setCustomFrom(event.target.value)} className="control"/></Field><Field label="По дату"><input type="date" value={customTo} onChange={event=>setCustomTo(event.target.value)} className="control"/></Field></>}
        <Field label="Компания или группа"><select value={scope} onChange={event=>setScope(event.target.value)} className="control"><option value="all">Все компании</option><option value="unassigned">Общее по группе</option>{groups.map(group=><option key={group} value={`group:${group}`}>Группа: {group}</option>)}{companies.filter(company=>company.isActive).map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span><b className="capitalize">Период: {selectedPeriod}</b><span className="ml-2 text-slate-500">· операций: {fmt(summary.count)}</span></span><span>Чистый поток: <b className={amountColor(summary.realNet)}>{fmt(summary.realNet)} ₽</b></span></div>
      {periodMode==="custom"&&customFrom&&customTo&&customFrom>customTo&&<p role="alert" className="text-sm text-red-600">Дата начала должна быть раньше даты окончания.</p>}
    </CardContent></Card>

    <p className="text-xs text-slate-500">Переводы между своими счетами исключены из чистого потока.</p>

    {periodMode==="year"&&<Card><div className="border-b px-4 py-3"><h2 className="font-semibold">{year} год: статьи по месяцам</h2><p className="mt-1 text-xs text-slate-500">Номер столбца соответствует номеру месяца; справа — сумма статьи за год.</p></div><div className="scroll-x"><table className="w-full min-w-[1280px] text-sm"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="sticky left-0 z-10 min-w-60 bg-slate-50 px-4 py-3 text-left">Статья</th>{MONTHS.map((name,index)=><th key={name} title={name} aria-label={`${index+1} — ${name}`} className="min-w-20 px-2 py-3 text-right">{index+1}</th>)}<th className="sticky right-0 z-10 min-w-28 bg-slate-100 px-3 py-3 text-right">Итого</th></tr></thead><tbody>{annualSections.flatMap(section=>[
      <tr key={`${section.section}:heading`}><th colSpan={14} className="bg-violet-50 px-4 py-2 text-left font-semibold text-violet-900">{section.section} деятельность</th></tr>,
      ...section.rows.map(row=><tr key={`${section.section}:${row.category}`} className="border-t border-slate-100"><td className="sticky left-0 bg-white px-4 py-3 font-medium text-slate-700">{row.category}</td>{row.months.map((value,index)=><td key={index} className={`px-2 py-3 text-right tabular-nums ${value===0?'text-slate-300':amountColor(value)}`}>{value===0?'—':fmt(value)}</td>)}<td className={`sticky right-0 bg-slate-50 px-3 py-3 text-right font-semibold tabular-nums ${amountColor(row.total)}`}>{fmt(row.total)} ₽</td></tr>)
    ])}</tbody></table></div></Card>}

    {summary.groups.length===0?<Card><CardContent className="py-10 text-center text-slate-500">За выбранный период операций нет.</CardContent></Card>:periodMode!=="year"&&summary.groups.map(group=><Card key={group.section} className={group.section===TECHNICAL_SECTION?"opacity-80":""}>
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{group.section} деятельность</h2><b className={amountColor(group.net)}>{fmt(group.net)} ₽</b></div><p className="mt-1 text-xs text-slate-500">{SECTION_HELP[group.section]}</p></div>
      <div className="divide-y divide-slate-100">{group.rows.map(row=>{const key=`${group.section}:${row.category}`,isOpen=expanded.has(key);return <div key={row.category} className="px-4 py-3 sm:px-5"><div className="flex items-center justify-between gap-4"><span className="font-medium text-slate-700">{row.category}</span><button type="button" aria-expanded={isOpen} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;})} className={`min-h-11 shrink-0 rounded-lg px-3 text-right font-semibold hover:bg-slate-100 ${amountColor(row.net)}`}>{fmt(row.net)} ₽ <span aria-hidden="true" className="ml-1 text-slate-400">{isOpen?'▴':'▾'}</span></button></div>{isOpen&&<div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2"><span>Поступило: <b className="text-emerald-700">{fmt(row.income)} ₽</b></span><span>Возвраты / списания: <b className="text-red-600">{row.expense?`−${fmt(row.expense)} ₽`:'0 ₽'}</b></span></div>}</div>})}</div>
    </Card>)}
  </div>;
}

function Field({label,children}:{label:string;children:ReactNode}){return <label className="block text-xs text-slate-500">{label}<div className="mt-1 [&_.control]:min-h-11 [&_.control]:w-full [&_.control]:rounded-lg [&_.control]:border [&_.control]:border-slate-300 [&_.control]:bg-white [&_.control]:px-3 [&_.control]:text-base sm:[&_.control]:text-sm">{children}</div></label>}
