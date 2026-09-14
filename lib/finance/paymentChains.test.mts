import test from "node:test";
import assert from "node:assert/strict";
import {allocationTotal,buildChainEntries,chainRemainder,chainMetadata,encodeChainMetadata,requiresKorovkinLoan,validateChain,chainIdForPayment,type PaymentChainDraft} from "./paymentChains.ts";
import {DDS_CATEGORIES} from "./categories.ts";
import type {Account} from "../types.ts";
const companies=[{id:'main',name:'ИП Митриченко',groupName:'Основная группа'},{id:'kor',name:'ИП Коровкин',groupName:'Коровкин'},{id:'fil',name:'ИП Филиппов',groupName:'Коровкин'},{id:'other',name:'ООО Другая',groupName:'Отдельная'}];
const accounts=[{id:'bank',name:'Точка',type:'bank'},{id:'cash',name:'Наличные группы',type:'cash'},{id:'korcash',name:'Наличные Коровкина',type:'cash'}].map(a=>({...a,currency:'RUB',balance:0}) as Account);
const draft=():PaymentChainDraft=>({id:'chain',revision:0,label:'55 тысяч в наличные',sourceDate:'2026-09-10',sourceAmount:55000,sourceAccountId:'bank',sourceCompanyId:'main',throughCash:true,cashAccountId:'cash',bankReviewId:null,originPaymentIds:[],allocations:[
 {id:'salary1',amount:5000,date:'2026-09-10',name:'Ефремова зп',category:'Зарплата административного персонала',companyId:'main',accountId:'cash',counterparty:'Ефремова',excluded:false},
 {id:'salary2',amount:10000,date:'2026-09-11',name:'Митриченко зп',category:'Зарплата административного персонала',companyId:'main',accountId:'cash',counterparty:'Митриченко',excluded:false},
 {id:'dividend',amount:30000,date:'2026-09-13',name:'Дивиденды Коровкину',category:'Дивиденды',companyId:'kor',accountId:'korcash',counterparty:'Андрей Коровкин',excluded:false},
]});
function entries(d:PaymentChainDraft){let i=0;return buildChainEntries(d,companies,()=>String(i++));}
test('55 thousand stays one source with 45 thousand spent on different dates and 10 thousand cash remainder',()=>{
 const d=draft();assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 assert.equal(allocationTotal(d),45000);assert.equal(chainRemainder(d),10000);
 const rows=entries(d);assert.equal(rows.length,7);
 assert.deepEqual(rows.filter(e=>e.role==='spending').map(e=>e.payment.date),['2026-09-10','2026-09-11','2026-09-13']);
 assert.equal(rows.reduce((sum,e)=>sum+e.payment.amount,0),-45000);
 assert.equal(rows.filter(e=>e.payment.accountId==='cash').reduce((sum,e)=>sum+e.payment.amount,0),10000);
 for(const row of rows){assert.equal(chainMetadata(row.payment.comment)?.amount,55000);assert.equal(chainIdForPayment(row.payment),'chain');}
});
test('main group expense on Korovkin is a loan through both cash wallets before dividends',()=>{
 const d=draft();d.sourceAmount=10000;d.allocations=[{...d.allocations[2],amount:10000,date:'2026-09-15'}];
 const rows=entries(d);assert.deepEqual(rows.map(e=>e.role),['source','cash-in','loan-out','loan-in','spending']);
 assert.equal(rows[2].payment.companyId,'main');assert.equal(rows[2].payment.accountId,'cash');assert.equal(rows[2].payment.amount,-10000);
 assert.equal(rows[3].payment.companyId,'kor');assert.equal(rows[3].payment.accountId,'korcash');assert.equal(rows[3].payment.amount,10000);
 assert.equal(rows[3].payment.date,'2026-09-10');assert.equal(rows[4].payment.date,'2026-09-15');
 assert.equal(rows.filter(e=>e.payment.accountId==='korcash').reduce((sum,e)=>sum+e.payment.amount,0),0);
});
test('changing the recipient to the main group removes the automatic loan from the new revision',()=>{
 const d=draft();d.revision=1;d.allocations[2]={...d.allocations[2],companyId:'main',accountId:'cash'};
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 assert.equal(entries(d).some(e=>e.role==='loan-in'||e.role==='loan-out'),false);
 assert.equal(chainMetadata(entries(d)[0].payment.comment)?.revision,2);
});
test('Filippov uses the Korovkin alias; other groups do not acquire this rule',()=>{
 assert.equal(requiresKorovkinLoan(companies[0],companies[2]),true);
 assert.equal(requiresKorovkinLoan(companies[3],companies[1]),false);
 assert.equal(requiresKorovkinLoan(companies[1],companies[1]),false);
});
test('rejects an overdrawn original sum, earlier expense date, and a loan from a bank wallet',()=>{
 const d=draft();d.allocations[2].amount=50000;assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/больше исходной/);
 d.allocations[2].amount=30000;d.allocations[2].date='2026-09-09';assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/не раньше/);
 d.allocations[2].date='2026-09-13';d.allocations[2].accountId='bank';assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/через наличные/);
});
test('requires salary recipient and permits a remaining cash balance without inventing an expense',()=>{
 const d=draft();d.allocations[0].counterparty='';assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/получателя/);
 d.allocations=[];assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);assert.equal(entries(d).length,2);assert.equal(chainRemainder(d),55000);
});
test('excluded parts do not create loans or expenses; malformed metadata does not pretend to be a chain',()=>{
 const d=draft();d.allocations[2].excluded=true;assert.equal(entries(d).length,4);
 assert.equal(chainMetadata('[dds-chain:garbage]'),null);
 const meta={id:'chain',revision:2,amount:55000,date:'2026-09-10',label:'Наличные [сентябрь]',role:'source' as const};
 assert.deepEqual(chainMetadata(encodeChainMetadata(meta,'[calendar-fact:abc] пояснение')),meta);
 assert.match(encodeChainMetadata(meta,'[calendar-fact:abc]'),/calendar-fact:abc/);
});

test('transfer to a card has its matching incoming entry and does not masquerade as an expense',()=>{
 const d=draft();d.allocations[2]={...d.allocations[2],category:'Выбытие — Перевод между счетами',targetAccountId:'bank'};
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 const rows=entries(d);assert.equal(rows.at(-1)?.role,'transfer-in');assert.equal(rows.at(-1)?.payment.amount,30000);
 assert.equal(rows.reduce((sum,e)=>sum+e.payment.amount,0),-15000);
 d.allocations[2].targetAccountId='';assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/кошелёк поступления/);
});
