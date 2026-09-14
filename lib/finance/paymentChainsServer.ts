import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadDdsExpenseCategories } from "./expenseCategoriesServer";
import { companyAliasKeys } from "./companyAliases";
import { readCompaniesCompat } from "./companySchema";
import { categoryOptions, TECHNICAL_SECTION, sectionForCategory, INTERCOMPANY_LOAN_CATEGORIES, LOAN_CATEGORIES } from "./categories";
import { buildChainEntries, chainIdForPayment, requiresKorovkinLoan, validateChain, type PaymentChainDraft, type PaymentChainDetail, type PaymentChainSummary, type ChainEntry, type ChainCompany } from "./paymentChains";
import type { Account, Payment } from "@/lib/types";
import { paymentTransferBalances } from "./paymentTransferBalance";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message: string, status=400) => Object.assign(new Error(message), {status});
function dbRequired() { const db=getSupabaseAdmin(); if(!db) throw fail("Supabase не настроен",503); return db; }
const missing = (e: {code?:string;message?:string} | null) => Boolean(e && (["42P01","42883","PGRST202","PGRST205"].includes(e.code??"") || /finance_payment_chain|save_dds_payment_chain/.test(e.message??"") && /does not exist|Could not find/.test(e.message??"")));
export const CHAIN_MIGRATION_MESSAGE = "Для сохранения цепочек владелец должен применить миграцию 202609140002_dds_payment_chains.sql. Старые платежи не изменены.";
function paymentFromRow(r: Record<string, unknown>): Payment {return {id:String(r.id),date:String(r.date).slice(0,10),name:String(r.name??""),amount:Number(r.amount),category:String(r.category),companyId:r.company_id?String(r.company_id):null,accountId:String(r.account_id),counterparty:String(r.counterparty??""),comment:r.comment?String(r.comment):undefined,status:r.status as Payment["status"],importSource:r.import_source?String(r.import_source):null};}
async function registry() {
 const db=dbRequired();
 const [c,a,x] = await Promise.all([
  readCompaniesCompat(columns=>db.from("companies").select(columns).order("id")),
  db.from("accounts").select("id,name,type,currency").order("id"),
  loadDdsExpenseCategories()
 ]);
 if(c.result.error) throw fail(c.result.error.message,500);
 if(a.error) throw fail(a.error.message,500);
 return {companies:((c.result.data??[]) as unknown as Array<Record<string,unknown>>).map(r=>({id:String(r.id),name:String(r.name),groupName:String(r.group_name)} as ChainCompany)),accounts:(a.data??[]).map(r=>({...r,balance:0} as Account)),categories:categoryOptions(undefined,x.categories.map(r=>r.name))};
}
export async function loadPaymentChain(seed: {paymentId?:string;reviewId?:string;chainId?:string}): Promise<PaymentChainDetail> {
 const db=dbRequired();
 for(const value of Object.values(seed)) if(value && !UUID.test(value)) throw fail("Некорректный идентификатор операции");
 let selected: Payment | null=null;
 if(seed.paymentId) {const r=await db.from("payments").select("*").eq("id",seed.paymentId).maybeSingle();if(r.error) throw fail(r.error.message,500);if(!r.data) throw fail("Платёж не найден",404);selected=paymentFromRow(r.data);}
 const id=seed.chainId??seed.reviewId??(selected?chainIdForPayment(selected)??selected.id:null);
 if(!id) throw fail("Укажите исходную операцию");
 const head=await db.from("finance_payment_chains").select("*").eq("id",id).maybeSingle();
 if(head.error && !missing(head.error)) throw fail(head.error.message,500);
 if(head.data) {
  const [links,revisions]=await Promise.all([
   loadAllSupabasePages<{payment_id:string;revision:number;role:string;allocation_id:string|null}>((from,to)=>db.from("finance_payment_chain_entries").select("payment_id,revision,role,allocation_id").eq("chain_id",id).order("payment_id").range(from,to),{label:"Части цепочки"}),
   loadAllSupabasePages<{revision:number;reason:string;created_at:string}>((from,to)=>db.from("finance_payment_chain_revisions").select("revision,reason,created_at").eq("chain_id",id).order("revision").range(from,to),{label:"История цепочки"})
  ]);
  const payments: Payment[]=[];
  for(let i=0;i<links.length;i+=300) {const rows=await db.from("payments").select("*").in("id",links.slice(i,i+300).map(l=>l.payment_id));if(rows.error)throw fail(rows.error.message,500);payments.push(...(rows.data??[]).map(paymentFromRow));}
  const byId=new Map(payments.map(p=>[p.id,p]));
  return {draft:{...head.data.draft,revision:head.data.revision},status:head.data.status,migrationAvailable:true,history:revisions.map(r=>({revision:r.revision,reason:r.reason,createdAt:r.created_at,entries:links.filter(l=>l.revision===r.revision).flatMap(l=>byId.has(l.payment_id)?[{payment:byId.get(l.payment_id)!,role:l.role==='legacy'?'source':l.role as ChainEntry['role'],allocationId:l.allocation_id}]:[])}))};
 }
 const canonicalId=seed.reviewId??(selected?chainIdForPayment(selected)??selected.id:null);
 if(!canonicalId || id!==canonicalId)throw fail("Укажите исходную операцию этой цепочки",404);
 const bankId=seed.reviewId??selected?.importSource?.match(/^bank-review:([0-9a-f-]{36})(?::|$)/i)?.[1];
 let review: Record<string,unknown> | null=null;
 let origins: Payment[]=selected?[selected]:[];
 if(bankId) {
  const r=await db.from("bank_review_items").select("id,date,amount,purpose,company_id,account_id,manager_answer,counterparty,source_file_name,status,category").eq("id",bankId).maybeSingle();if(r.error)throw fail(r.error.message,500);if(!r.data)throw fail("Исходная банковская операция не найдена",404);review=r.data;
  origins=(await loadAllSupabasePages<Record<string,unknown>>((from,to)=>db.from("payments").select("*").like("import_source","bank-review:"+bankId+"%").eq("status","done").order("id").range(from,to),{label:"Исходные части банковской операции"})).map(paymentFromRow);
 }
 if(review && Number(review.amount)>=0)throw fail("Цепочка распределения создаётся из расхода, а не банковского поступления");
 if(!review && (!selected || selected.amount>=0 || selected.status!=='done')) throw fail("Цепочку можно создать из фактического расхода");
 const reg=await registry();
 const sourceAmount=Math.abs(Number(review?.amount??selected!.amount));
 const sourceDate=String(review?.date??selected!.date).slice(0,10);
 const sourceCompanyId=String(review?.company_id??selected?.companyId??"");
 const sourceAccountId=String(review?.account_id??selected?.accountId??"");
 let raw: Array<{id?:string;amount:number;description:string;category:string|null;companyId:string|null;accountId?:string|null;excluded?:boolean;countsTowardBank?:boolean;isRemainder?:boolean}> = [];
 if(review && typeof review.manager_answer==='string' && review.manager_answer.startsWith('__bank_split_v1:')) {try{const decoded=JSON.parse(review.manager_answer.slice('__bank_split_v1:'.length));if(Array.isArray(decoded))raw=decoded;}catch{}}
 const costs=origins.filter(p=>p.amount<0 && sectionForCategory(p.category)!==TECHNICAL_SECTION && p.category!==INTERCOMPANY_LOAN_CATEGORIES.issued);
 const cash=reg.accounts.filter(a=>a.type==='cash' && a.currency==='RUB');
 const allocations=costs.length?costs.map(p=>({id:crypto.randomUUID(),amount:Math.abs(p.amount),date:p.date,name:p.name,category:p.category,companyId:p.companyId??sourceCompanyId,accountId:p.accountId,counterparty:p.counterparty,excluded:false})):
  raw.filter(a=>a.countsTowardBank!==false&&!a.isRemainder).map(a=>({id:crypto.randomUUID(),amount:a.amount,date:sourceDate,name:a.description,category:a.category??"",companyId:a.companyId??sourceCompanyId,accountId:a.accountId??sourceAccountId,counterparty:/зарплат/i.test(a.category??"")?a.description.replace(/(?:^|[^а-я])зп(?:$|[^а-я])|зарплата/gi," ").trim():"",excluded:Boolean(a.excluded)}));
 if(!allocations.length && !raw.length && (origins.length || review?.category) && sectionForCategory(selected?.category??String(review?.category??""))!==TECHNICAL_SECTION) allocations.push({id:crypto.randomUUID(),amount:sourceAmount,date:sourceDate,name:selected?.name??String(review?.purpose??""),category:selected?.category??String(review?.category??""),companyId:selected?.companyId??sourceCompanyId,accountId:sourceAccountId,counterparty:selected?.counterparty??"",excluded:false});
 if(!raw.length && review) {
  const mentioned=companyAliasKeys(String(review.manager_answer??"")+" "+String(review.purpose??""));
  const recipients=reg.companies.filter(c=>mentioned.some(key=>c.name.toLowerCase().includes(key)));
  if(recipients.length===1) for(const a of allocations) if(requiresKorovkinLoan(reg.companies.find(c=>c.id===sourceCompanyId),recipients[0])) a.companyId=recipients[0].id;
 }
 const throughCash=allocations.some(a=>requiresKorovkinLoan(reg.companies.find(c=>c.id===sourceCompanyId),reg.companies.find(c=>c.id===a.companyId))) || origins.some(p=>sectionForCategory(p.category)===TECHNICAL_SECTION) || sectionForCategory(String(review?.category??""))===TECHNICAL_SECTION;
 if(throughCash) for(const a of allocations) a.accountId=cash.length===1?cash[0].id:"";
 return {draft:{id,revision:0,label:String(review?.purpose??selected?.name??"Исходная сумма"),sourceDate,sourceAmount,sourceAccountId,sourceCompanyId,cashAccountId:cash.length===1?cash[0].id:"",throughCash,allocations,originPaymentIds:origins.map(p=>p.id),bankReviewId:bankId??null},status:"active",migrationAvailable:!head.error,history:[]};
}
function parseDraft(value: unknown): PaymentChainDraft {
 if(!value || typeof value!=="object")throw fail("Некорректная цепочка");
 const d=value as PaymentChainDraft;
 if(!UUID.test(d.id??"") || !Number.isInteger(d.revision) || d.revision<0 || !Array.isArray(d.allocations) || d.allocations.length>100 || typeof d.throughCash!=="boolean")throw fail("Некорректная цепочка");
 for(const key of ['label','sourceDate','sourceAccountId','sourceCompanyId','cashAccountId'] as const) if(typeof d[key]!=='string'||d[key].length>2000)throw fail("Некорректные поля цепочки");
 for(const a of d.allocations) {if(!a||!UUID.test(a.id??"")||typeof a.excluded!=='boolean')throw fail("Некорректная часть");for(const key of ['date','name','category','companyId','accountId','counterparty'] as const)if(typeof a[key]!=='string'||a[key].length>2000)throw fail("Некорректные поля части");}
 return d;
}
export async function savePaymentChain(body: Record<string,unknown>) {
 const d=parseDraft(body.draft);
 const previous=await loadPaymentChain({chainId:d.id,paymentId:typeof body.paymentId==='string'?body.paymentId:undefined,reviewId:typeof body.reviewId==='string'?body.reviewId:undefined});
 if(!previous.migrationAvailable)throw fail(CHAIN_MIGRATION_MESSAGE,503);
 if(previous.draft.id!==d.id || previous.draft.revision!==d.revision)throw fail("Цепочка изменилась. Откройте её заново.",409);
 d.originPaymentIds=d.revision===0?previous.draft.originPaymentIds:[];
 d.bankReviewId=previous.draft.bankReviewId;
 if(d.bankReviewId && (d.sourceAmount!==previous.draft.sourceAmount || d.sourceDate!==previous.draft.sourceDate || d.sourceAccountId!==previous.draft.sourceAccountId)) throw fail("Исходная дата, сумма и банковский кошелёк берутся из выписки. Измените распределение частей.");
 const cancel=body.cancel===true;
 const reg=await registry();
 if(!cancel) {const errors=validateChain(d,reg.accounts,reg.companies,reg.categories);if(errors.length)throw fail(errors.join(". "));}
 const entries=cancel?[]:buildChainEntries(d,reg.companies);
 const imbalance=paymentTransferBalances(entries).find(group=>!group.balanced);
 if(imbalance)throw fail(imbalance.label+": выбытие и поступление не сходятся, разница "+imbalance.net+" ₽");
 const r=await dbRequired().rpc("save_dds_payment_chain",{p_chain_id:d.id,p_expected_revision:d.revision,p_draft:d,p_entries:entries,p_origin_ids:d.originPaymentIds,p_cancel:cancel});
 if(r.error)throw fail(missing(r.error)?CHAIN_MIGRATION_MESSAGE:r.error.message,missing(r.error)?503:r.error.code==='40001'?409:500);
 return r.data;
}

export async function listPaymentChains(): Promise<PaymentChainSummary[]> {
 const db=dbRequired();
 let heads: Array<{id:string;revision:number;status:'active'|'cancelled';draft:PaymentChainDraft}>=[];
 try {heads=await loadAllSupabasePages((from,to)=>db.from('finance_payment_chains').select('id,revision,status,draft').order('id').range(from,to),{label:'Исходные суммы ДДС'});}catch(e){if(!missing(e as {code?:string}))throw e;}
 const legacy=await loadAllSupabasePages<Record<string,unknown>>((from,to)=>db.from('payments').select('id,date,import_source').like('import_source','bank-review:%').lt('amount',0).eq('status','done').order('id').range(from,to),{label:'Ранее разбитые суммы ДДС'});
 const groups=new Map<string,Array<Record<string,unknown>>>();
 for(const p of legacy){const id=String(p.import_source).match(/^bank-review:([0-9a-f-]{36})(?::|$)/i)?.[1];if(id&&!heads.some(h=>h.id===id)){const group=groups.get(id)??[];group.push(p);groups.set(id,group);}}
 const bank=new Map<string,{amount:number;date:string;purpose:string;account_id:string|null;company_id:string|null}>();
 const ids=[...groups.keys()];
 for(let i=0;i<ids.length;i+=300){const r=await db.from('bank_review_items').select('id,amount,date,purpose,account_id,company_id').in('id',ids.slice(i,i+300));if(r.error)throw fail(r.error.message,500);for(const row of r.data??[])bank.set(row.id,row);}
 const current=heads.map(h=>({id:h.id,chainId:h.id,sourceAccountId:h.draft.sourceAccountId,sourceCompanyId:h.draft.sourceCompanyId,label:h.draft.label,amount:h.draft.sourceAmount,date:h.draft.sourceDate,lastDate:[h.draft.sourceDate,...h.draft.allocations.map(a=>a.date)].sort().at(-1)!,count:h.draft.allocations.length,revision:h.revision,status:h.status}));
 const old=[...groups].map(([id,parts])=>{const b=bank.get(id);return {id,paymentId:String(parts[0].id),sourceAccountId:b?.account_id,sourceCompanyId:b?.company_id,label:b?.purpose??'Исходная выписка недоступна',amount:b?Math.abs(Number(b.amount)):null,date:b?.date??String(parts[0].date),lastDate:parts.map(p=>String(p.date)).sort().at(-1)!,count:parts.length,revision:0,status:'active' as const};});
 return [...current,...old].sort((a,b)=>b.date.localeCompare(a.date));
}
