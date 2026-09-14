"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findCertainTransferPairs } from "@/lib/opiu/bankTransferMatching";
import { formatMoney } from "@/lib/format";
import { loadFinanceState } from "@/lib/db";
import { useFinance } from "@/components/providers/FinanceProvider";

type Row = {id:string;date:string;amount:number;source_file_name:string;bank_account_number:string;owner_inn:string;counterparty_inn:string;reasons:string[];matched_transfer_id:string|null};
export function BankTransfersPanel() {
  const {dispatch}=useFinance();
  const [rows,setRows]=useState<Row[]>([]),[open,setOpen]=useState(false),[outgoingId,setOutgoingId]=useState(""),[incomingId,setIncomingId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const refresh=useCallback(async()=>{
    const response=await fetch("/api/opiu/bank-review?resource=transfers"); const data=await response.json();
    if(!response.ok)throw new Error(data.error ?? "Не удалось прочитать связи выписок");
    setRows((data.items ?? []).map((row:Row)=>({...row,amount:Number(row.amount)})));
  },[]);
  useEffect(()=>{if(open)refresh().catch(e=>setError(e.message));},[open,refresh]);
  const outgoing=rows.find(r=>r.id===outgoingId);
  const candidates=useMemo(()=>!outgoing?[]:rows.filter(r=>r.amount>0&&!r.matched_transfer_id&&findCertainTransferPairs([outgoing,r].map(item=>({id:item.id,date:item.date,amount:item.amount,bankAccountNumber:item.bank_account_number ?? "",ownerInn:item.owner_inn ?? "",counterpartyInn:item.counterparty_inn ?? "",counterpartyAccount:(item.reasons ?? []).find(s=>s.startsWith("__counterparty_account:"))?.slice("__counterparty_account:".length) ?? ""}))).length===1),[outgoing,rows]);
  const run=async(action:"match_transfers"|"link_transfer")=>{
    setBusy(true);setError("");
    try {const response=await fetch("/api/opiu/bank-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,outgoingId,incomingId})});const data=await response.json();if(!response.ok)throw new Error(data.error);await refresh();dispatch({type:"LOAD",payload:await loadFinanceState()});setOutgoingId("");setIncomingId("");}
    catch(e){setError(e instanceof Error?e.message:"Не удалось связать операции");}finally{setBusy(false);}
  };
  const label=(r:Row)=>`${r.date} · ${formatMoney(r.amount)} · ${r.bank_account_number} · ${r.source_file_name}`;
  return <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
    <button type="button" onClick={()=>setOpen(!open)} className="min-h-11 text-left font-semibold text-slate-800" aria-expanded={open}>Связи между выписками {open?"▴":"▾"}</button>
    {open&&<div className="space-y-3 text-sm">
      <p className="text-slate-500">Встречные суммы сверяются до копейки, даты — с разницей до трёх дней. Реквизиты должны подтверждать перевод между разными счетами. Подтверждённые выписки тоже участвуют.</p>
      <button type="button" disabled={busy} onClick={()=>void run("match_transfers")} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">Найти связи в загруженных выписках</button>
      {rows.filter(r=>r.amount<0&&r.matched_transfer_id).map(r=>{const other=rows.find(i=>i.id===r.matched_transfer_id);return <div key={r.id} className="rounded-lg bg-slate-50 p-3"><div>{label(r)}</div><div className="mt-1">↓ {other?label(other):"Встречная операция недоступна"}</div><div className={other&&Math.round((r.amount+other.amount)*100)===0?"text-emerald-700":"text-red-600"}>Разница: {other?formatMoney(r.amount+other.amount):"проверьте встречную сторону"}</div></div>;})}
      <div className="grid gap-2 md:grid-cols-2">
        <label>Выбытие<select className="mt-1 min-h-11 w-full rounded-lg border px-2" value={outgoingId} onChange={e=>{setOutgoingId(e.target.value);setIncomingId("");}}><option value="">Выберите операцию</option>{rows.filter(r=>r.amount<0&&!r.matched_transfer_id).map(r=><option key={r.id} value={r.id}>{label(r)}</option>)}</select></label>
        <label>Встречное поступление<select className="mt-1 min-h-11 w-full rounded-lg border px-2" value={incomingId} onChange={e=>setIncomingId(e.target.value)} disabled={!outgoing}><option value="">Выберите встречную операцию</option>{candidates.map(r=><option key={r.id} value={r.id}>{label(r)}</option>)}</select></label>
      </div>
      {outgoing&&candidates.length===0&&<p className="text-amber-700">Нет поступления с подходящими суммой, датой и реквизитами. Загрузите встречную выписку или проверьте номера счетов.</p>}
      <button type="button" disabled={busy||!incomingId||!candidates.some(r=>r.id===incomingId)} onClick={()=>void run("link_transfer")} className="min-h-11 rounded-lg bg-violet-600 px-4 text-white disabled:opacity-50">Связать выбранные операции</button>
      {error&&<p role="alert" className="text-red-600">{error}</p>}
    </div>}
  </section>;
}
