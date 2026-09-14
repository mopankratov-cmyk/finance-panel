"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";
import { useDdsCategories } from "@/components/providers/FinanceProvider";
import { TRANSFER_CATEGORIES } from "@/lib/finance/categories";
import { allocationTotal, buildChainEntries, chainRemainder, requiresKorovkinLoan, validateChain, type ChainAllocation, type PaymentChainDetail } from "@/lib/finance/paymentChains";
export interface PaymentChainSeed {paymentId?: string; reviewId?: string; chainId?: string}
const field="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";
const roleLabel={source:"Исходная операция", "cash-in":"Поступление в наличные", "loan-out":"Выдача займа", "loan-in":"Получение займа", spending:"Расход / перевод", "transfer-in":"Поступление на кошелёк"};
async function json<T>(response: Response) {const body=await response.json();if(!response.ok)throw new Error(body.error??"Не удалось выполнить действие");return body as T;}
export function PaymentChainModal({seed,accounts,companies,onClose,onSaved}:{seed:PaymentChainSeed;accounts:Account[];companies:DdsCompany[];onClose:()=>void;onSaved:()=>Promise<void>}) {
 const {categories}=useDdsCategories();
 const [detail,setDetail]=useState<PaymentChainDetail|null>(null);
 const [error,setError]=useState(""); const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
 const query=useMemo(()=>new URLSearchParams({resource:"payment-chain",...(seed.paymentId?{payment_id:seed.paymentId}:{}),...(seed.reviewId?{review_id:seed.reviewId}:{}),...(seed.chainId?{chain_id:seed.chainId}:{})}).toString(),[seed.paymentId,seed.reviewId,seed.chainId]);
 useEffect(()=>{let cancelled=false;fetch("/api/finance/companies?"+query,{cache:"no-store"}).then(json<PaymentChainDetail>).then(d=>{if(!cancelled)setDetail(d);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[query]);
 const close=useCallback(()=>{if(!busy)onClose();},[busy,onClose]);
 const draft=detail?.draft;
 const errors=draft?validateChain(draft,accounts,companies,categories):[];
 let index=0;
 const entries=draft && !errors.length?buildChainEntries(draft,companies,()=>"preview-"+index++):[];
 const patch=(p: Partial<NonNullable<typeof draft>>) => setDetail(d=>d?{...d,draft:{...d.draft,...p}}:d);
 const changePart=(id:string,p:Partial<ChainAllocation>)=>{if(draft)patch({allocations:draft.allocations.map(a=>a.id===id?{...a,...p}:a)});};
 const save=async(cancel=false)=>{
  if(!detail || (!cancel && errors.length))return;
  if(cancel && !confirm("Отменить все действующие записи этой цепочки? Они сохранятся в истории и перестанут участвовать в ДДС."))return;
  setBusy(true);setError("");setMessage("");
  try {
   await fetch("/api/finance/companies",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"payment-chain",draft:detail.draft,...seed,cancel})}).then(json);
   const refreshed=await fetch("/api/finance/companies?resource=payment-chain&chain_id="+detail.draft.id,{cache:"no-store"}).then(json<PaymentChainDetail>);
   setDetail(refreshed);await onSaved();setMessage(cancel?"Цепочка отменена. Все версии сохранены в истории.":"Цепочка сохранена. Прежние связанные записи отменены.");
  }catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить цепочку");}finally{setBusy(false);}
 };
 const companyName=(id:string|null|undefined)=>companies.find(c=>c.id===id)?.name??"Компания не определена";
 const accountName=(id:string)=>accounts.find(a=>a.id===id)?.name??"Кошелёк не определён";
 return <Modal open onClose={close} size="xl" title="Исходная сумма и цепочка операций" footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-lg border px-3">Закрыть</button>{detail && draft && draft.revision>0 && detail.status==='active' && <button type="button" disabled={busy} onClick={()=>void save(true)} className="min-h-11 rounded-lg border border-red-300 px-3 text-red-700">Отменить цепочку</button>}<button type="button" disabled={busy||!detail?.migrationAvailable||!draft||errors.length>0} onClick={()=>void save()} className="min-h-11 rounded-lg bg-violet-600 px-4 font-medium text-white disabled:opacity-40">{busy?"Сохраняю…":draft?.revision?"Сохранить новую версию":"Сохранить цепочку"}</button></div>}>
  <div className="space-y-5">
   {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
   {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
   {!detail&&!error&&<p>Загружаю исходную сумму и связанные записи…</p>}
   {detail&&draft&&<>
    {!detail.migrationAvailable&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">Сохранение станет доступно после применения владельцем миграции цепочек ДДС. Сейчас записи не изменяются.</p>}
    {detail.status==='cancelled'&&<p className="rounded-lg bg-amber-50 p-3 text-amber-900">Эта цепочка отменена. Можно исправить распределение и сохранить новую версию.</p>}
    <p className="text-sm text-slate-600">Вся исходная сумма и расходы по ней показаны вместе независимо от фильтров дат реестра. Каждая часть проводится своей датой. Версия {draft.revision}.</p>
    <div className="grid gap-3 sm:grid-cols-3">
     <div className="rounded-xl bg-violet-50 p-3"><p className="text-xs text-violet-700">Исходная сумма</p><p className="text-xl font-semibold">{formatMoney(draft.sourceAmount)}</p></div>
     <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Распределено, включая исключённые части</p><p className="text-xl font-semibold">{formatMoney(allocationTotal(draft))}</p></div>
     <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-800">Осталось распределить</p><p className="text-xl font-semibold">{formatMoney(chainRemainder(draft))}</p></div>
    </div>
    <fieldset disabled={busy} className="space-y-4"><legend className="mb-2 font-semibold">Источник денег</legend>
     <label className="block text-sm">Название исходной суммы<input className={field} value={draft.label} onChange={e=>patch({label:e.target.value})}/></label>
     <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Дата исходного перевода<input type="date" className={field} disabled={Boolean(draft.bankReviewId)} value={draft.sourceDate} onChange={e=>patch({sourceDate:e.target.value})}/></label><label className="text-sm">Исходная сумма<input type="number" min="0.01" step="0.01" className={field} disabled={Boolean(draft.bankReviewId)} value={draft.sourceAmount} onChange={e=>patch({sourceAmount:Number(e.target.value)})}/></label>
      <label className="text-sm">Компания источника<select className={field} value={draft.sourceCompanyId} onChange={e=>patch({sourceCompanyId:e.target.value})}><option value="">Выберите компанию</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-sm">Кошелёк источника<select className={field} disabled={Boolean(draft.bankReviewId)} value={draft.sourceAccountId} onChange={e=>patch({sourceAccountId:e.target.value})}><option value="">Выберите кошелёк</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     </div>
     <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.throughCash} onChange={e=>{const throughCash=e.target.checked;patch({throughCash,allocations:draft.allocations.map(a=>({...a,accountId:throughCash?draft.cashAccountId:draft.sourceAccountId}))});}}/>Сначала перевести исходную сумму в наличные</label>
     {draft.throughCash&&<label className="block text-sm">Наличные основной группы<select className={field} value={draft.cashAccountId} onChange={e=>{const id=e.target.value;patch({cashAccountId:id,allocations:draft.allocations.map(a=>requiresKorovkinLoan(companies.find(c=>c.id===draft.sourceCompanyId),companies.find(c=>c.id===a.companyId))?a:{...a,accountId:id})});}}><option value="">Выберите наличный кошелёк</option>{accounts.filter(a=>a.type==='cash'&&a.currency==='RUB').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
    </fieldset>
    <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 font-semibold">На что распределена сумма {formatMoney(draft.sourceAmount)}</legend>
     {draft.allocations.map((a,i)=>{const loan=requiresKorovkinLoan(companies.find(c=>c.id===draft.sourceCompanyId),companies.find(c=>c.id===a.companyId));return <div key={a.id} className="space-y-3 rounded-xl border border-slate-200 p-3"><div className="flex justify-between"><b className="text-sm">Часть {i+1} из {formatMoney(draft.sourceAmount)}</b><button type="button" onClick={()=>patch({allocations:draft.allocations.filter(p=>p.id!==a.id)})} className="min-h-11 rounded-lg px-3 text-sm text-red-600">Убрать часть</button></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Сумма части<input type="number" min="0.01" step="0.01" className={field} value={a.amount} onChange={e=>changePart(a.id,{amount:Number(e.target.value)})}/></label><label className="text-sm">Дата расхода<input type="date" min={draft.sourceDate} className={field} value={a.date} onChange={e=>changePart(a.id,{date:e.target.value})}/></label></div>
      <label className="block text-sm">Назначение<input className={field} value={a.name} onChange={e=>changePart(a.id,{name:e.target.value})}/></label>
      {!a.excluded&&<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Компания расхода<select className={field} value={a.companyId} onChange={e=>changePart(a.id,{companyId:e.target.value})}><option value="">Выберите компанию</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm">Кошелёк расхода<select className={field} value={a.accountId} onChange={e=>changePart(a.id,{accountId:e.target.value})}><option value="">Выберите кошелёк</option>{accounts.filter(acc=>!loan||acc.type==='cash').map(acc=><option key={acc.id} value={acc.id}>{acc.name}</option>)}</select></label><label className="text-sm">Статья расхода<select className={field} value={a.category} onChange={e=>changePart(a.id,{category:e.target.value})}><option value="">Выберите статью</option>{[...new Set([...categories,a.category].filter(Boolean))].map(c=><option key={c}>{c}</option>)}</select></label><label className="text-sm">Получатель<input className={field} value={a.counterparty} onChange={e=>changePart(a.id,{counterparty:e.target.value})}/></label></div>}
      {a.category===TRANSFER_CATEGORIES.outgoing&&!a.excluded&&<label className="block text-sm">Куда переведены деньги<select className={field} value={a.targetAccountId??""} onChange={e=>changePart(a.id,{targetAccountId:e.target.value})}><option value="">Выберите кошелёк поступления</option>{accounts.filter(acc=>acc.id!==a.accountId&&acc.currency==='RUB').map(acc=><option key={acc.id} value={acc.id}>{acc.name}</option>)}</select></label>}
      {loan&&!a.excluded&&<p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">Основная группа → {companyName(a.companyId)}: выдача займа из наличных → получение займа в наличные → {a.category||"последующий расход"} {formatDate(a.date)}. Обе стороны займа создадутся автоматически.</p>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={a.excluded} onChange={e=>changePart(a.id,{excluded:e.target.checked})}/>Не включать эту часть в отчёт ДДС</label>
     </div>;})}
     <button type="button" disabled={chainRemainder(draft)<=0} onClick={()=>patch({allocations:[...draft.allocations,{id:crypto.randomUUID(),amount:Math.max(0,chainRemainder(draft)),date:draft.sourceDate,name:"",category:"",companyId:draft.sourceCompanyId,accountId:draft.throughCash?draft.cashAccountId:draft.sourceAccountId,counterparty:"",excluded:false}]})} className="min-h-11 rounded-lg border border-violet-300 px-3 text-sm text-violet-800 disabled:opacity-40">+ Добавить расход из остатка {formatMoney(chainRemainder(draft))}</button>
    </fieldset>
    {errors.length>0&&<div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{errors.map(e=><p key={e}>{e}</p>)}</div>}
    {entries.length>0&&<section className="space-y-2"><h3 className="font-semibold">Так будет выглядеть вся цепочка</h3>{entries.map(e=><div key={e.payment.id} className="rounded-lg border-l-4 border-violet-300 bg-slate-50 p-3 text-sm"><div className="flex flex-wrap gap-2"><b>{roleLabel[e.role]}</b><span>{formatDate(e.payment.date)}</span><b className={e.payment.amount<0?'text-red-600':'text-emerald-700'}>{formatMoney(e.payment.amount)}</b></div><p>{companyName(e.payment.companyId)} · {accountName(e.payment.accountId)}</p><p className="text-slate-600">{e.payment.category} · {e.payment.name}</p></div>)}</section>}
    {detail.history.length>0&&<section className="space-y-2"><h3 className="font-semibold">История цепочки</h3>{[...detail.history].reverse().map(h=><details key={h.revision} className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer text-sm">Версия {h.revision} · {h.reason} · {new Date(h.createdAt).toLocaleString('ru-RU')} · {h.entries.length} записей</summary><div className="space-y-2">{h.entries.map(e=><p key={e.payment.id} className="break-anywhere rounded bg-slate-50 p-2 text-sm">{formatDate(e.payment.date)} · {formatMoney(e.payment.amount)} · {e.payment.category} · {companyName(e.payment.companyId)} · {accountName(e.payment.accountId)} · {e.payment.status==='cancelled'?'Отменено':'Действует'}</p>)}</div></details>)}</section>}
   </>}
  </div>
 </Modal>;
}
