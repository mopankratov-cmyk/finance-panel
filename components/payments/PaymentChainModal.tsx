"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney } from "@/lib/format";
import type { Account } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";
import { useDdsCategories } from "@/components/providers/FinanceProvider";
import { PaymentSplitEditor } from "./PaymentSplitEditor";
import { buildChainEntries, validateChain, type PaymentChainDetail } from "@/lib/finance/paymentChains";
export interface PaymentChainSeed {paymentId?: string; reviewId?: string; chainId?: string}
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
 const save=async(cancel=false)=>{
  if(!detail || (!cancel && errors.length))return;
  if(cancel && !confirm("Отменить операцию со всеми связанными записями? Они сохранятся в истории и перестанут участвовать в ДДС."))return;
  setBusy(true);setError("");setMessage("");
  try {
   await fetch("/api/finance/companies",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"payment-chain",draft:detail.draft,...seed,cancel})}).then(json);
   const refreshed=await fetch("/api/finance/companies?resource=payment-chain&chain_id="+detail.draft.id,{cache:"no-store"}).then(json<PaymentChainDetail>);
   setDetail(refreshed);await onSaved();setMessage(cancel?"Операция отменена. Все версии сохранены в истории.":"Операция сохранена. Прежние связанные записи отменены.");
  }catch(e){setError(e instanceof Error?e.message:"Не удалось сохранить операцию");}finally{setBusy(false);}
 };
 const companyName=(id:string|null|undefined)=>companies.find(c=>c.id===id)?.name??"Компания не определена";
 const accountName=(id:string)=>accounts.find(a=>a.id===id)?.name??"Кошелёк не определён";
 return <Modal open onClose={close} size="xl" title="Редактировать операцию" footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{draft?.revision ? 'Версия ' + draft.revision + ' · изменения сохраняются в истории' : 'Части сохраняются вместе с операцией'}</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={close} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm">Отмена</button><button type="button" disabled={busy || !detail?.migrationAvailable || !draft || errors.length > 0} onClick={()=>void save()} className="min-h-11 rounded-lg bg-violet-600 px-5 text-sm font-medium text-white disabled:opacity-40">{busy ? 'Сохраняю…' : 'Сохранить'}</button></div></div>}>
  <div className="space-y-4">
   {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
   {!detail && !error && <p>Загружаю операцию…</p>}
   {detail && draft && <>
    {!detail.migrationAvailable && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Сохранение станет доступно после применения владельцем миграции цепочек ДДС.</p>}
    {detail.status === 'cancelled' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Операция отменена. Исправьте разбивку и сохраните, чтобы восстановить её новой версией.</p>}
    <PaymentSplitEditor draft={draft} accounts={accounts} companies={companies} categories={categories} busy={busy} patch={patch}/>
    {errors.length > 0 && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{errors.map(e=><p key={e}>{e}</p>)}</div>}
    {entries.length > 0 && <details className="rounded-lg border border-slate-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">Связанные переводы и займы · {entries.length} записей</summary><div className="space-y-2 pb-3">{entries.map(e=><div key={e.payment.id} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{roleLabel[e.role]} · {formatDate(e.payment.date)}</span><b>{formatMoney(e.payment.amount)}</b></div><p className="mt-1 text-slate-600">{companyName(e.payment.companyId)} · {accountName(e.payment.accountId)}</p><p className="text-slate-600">{e.payment.category}</p></div>)}</div></details>}
    <details className="rounded-lg border border-slate-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-600">История изменений{detail.history.length ? ' · ' + detail.history.length + ' версий' : ''}</summary><div className="space-y-2 pb-3">{detail.history.length ? [...detail.history].reverse().map(h=><details key={h.revision} className="rounded-lg bg-slate-50 p-3"><summary className="min-h-11 cursor-pointer text-sm">Версия {h.revision} · {new Date(h.createdAt).toLocaleString('ru-RU')} · {h.reason}</summary><div className="space-y-2">{h.entries.map(e=><p key={e.payment.id} className="break-anywhere text-sm">{formatDate(e.payment.date)} · {formatMoney(e.payment.amount)} · {e.payment.category} · {companyName(e.payment.companyId)} · {accountName(e.payment.accountId)} · {e.payment.status === 'cancelled' ? 'Отменено' : 'Действует'}</p>)}</div></details>) : <p className="text-sm text-slate-500">История появится после первого сохранения.</p>}</div></details>
    {draft.revision > 0 && detail.status === 'active' && <button type="button" disabled={busy} onClick={()=>void save(true)} className="min-h-11 rounded-lg px-3 text-sm text-red-700 hover:bg-red-50">Отменить операцию со всеми связанными записями</button>}
   </>}
  </div>
 </Modal>;
}
