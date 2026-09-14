import { TRANSFER_CATEGORIES } from "./categories";
import { chainMetadata, type ChainEntry } from "./paymentChains";
import type { Payment } from "@/lib/types";

export interface TransferBalance {
  id: string; label: string; entries: ChainEntry[]; net: number; balanced: boolean;
}

export function paymentTransferBalances(entries: ChainEntry[]): TransferBalance[] {
  const groups = new Map<string, TransferBalance>();
  for (const entry of entries) {
    let kind: "cash" | "loan" | "wallet" | null = null;
    if (entry.role === "loan-out" || entry.role === "loan-in") kind = "loan";
    else if (entry.role === "cash-in" || (entry.role === "source" && !entry.allocationId && entry.payment.category === TRANSFER_CATEGORIES.outgoing)) kind = "cash";
    else if (entry.role === "transfer-in" || ((entry.role === "source" || entry.role === "spending") && entry.payment.category === TRANSFER_CATEGORIES.outgoing)) kind = "wallet";
    if (!kind) continue;
    const id = kind + ":" + (entry.allocationId ?? "source");
    const group = groups.get(id) ?? { id, label: kind === "loan" ? "Займ между компаниями" : kind === "cash" ? "Перевод исходной суммы в наличные" : "Перевод между кошельками", entries: [], net: 0, balanced: false };
    group.entries.push(entry);
    groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    const net = group.entries.reduce((sum, entry) => sum + Math.round(entry.payment.amount * 100), 0) / 100;
    return { ...group, net, balanced: net === 0 && group.entries.length === 2 && group.entries.filter(e => e.payment.amount < 0).length === 1 && group.entries.filter(e => e.payment.amount > 0).length === 1 };
  });
}

export function ledgerTransferBalances(payments: Payment[]) {
  const chains = new Map<string, ChainEntry[]>();
  const unlinked: Payment[] = [];
  const bankPairs = new Map<string, Payment[]>();
  for (const payment of payments) {
    if (payment.status !== "done") continue;
    const meta = chainMetadata(payment.comment);
    const bankPair = payment.comment?.match(/\[dds-bank-transfer:([a-f0-9-]{36})\]/)?.[1];
    if (!meta && bankPair) {
      bankPairs.set(bankPair, [...(bankPairs.get(bankPair) ?? []),payment]);
      continue;
    }
    if (meta) {
      const id = meta.id + ":" + meta.revision;
      const entries = chains.get(id) ?? [];
      entries.push({ payment, role: meta.role, allocationId: meta.allocationId ?? null });
      chains.set(id, entries);
    } else if (payment.category === TRANSFER_CATEGORIES.outgoing || payment.category === TRANSFER_CATEGORIES.incoming) unlinked.push(payment);
  }
  const linked = [...chains].flatMap(([id, entries]) => paymentTransferBalances(entries).map(group => ({ ...group, id: id + ":" + group.id })));
  for (const [id, payments] of bankPairs) {
    const net=payments.reduce((sum,p)=>sum+Math.round(p.amount*100),0)/100;
    linked.push({id:"bank:"+id,label:"Перевод между выписками",net,balanced:net===0&&payments.length===2&&payments.filter(p=>p.amount<0).length===1&&payments.filter(p=>p.amount>0).length===1,entries:payments.map(payment=>({payment,role:payment.amount<0?"source":"transfer-in",allocationId:null}))});
  }
  return { linked, unlinked, unlinkedNet: unlinked.reduce((sum,p) => sum + Math.round(p.amount * 100),0) / 100 };
}
