import test from "node:test";
import assert from "node:assert/strict";
import { paymentTransferBalances, ledgerTransferBalances } from "./paymentTransferBalance.ts";
import { buildChainEntries, type PaymentChainDraft } from "./paymentChains.ts";
import { TRANSFER_CATEGORIES } from "./categories.ts";
const companies=[{id:"main",name:"ИП Митриченко",groupName:"Основная группа"},{id:"kor",name:"ИП Коровкин",groupName:"Коровкин"}];
const draft:PaymentChainDraft={id:"chain",revision:0,label:"55 тысяч",sourceDate:"2026-09-10",sourceAmount:55000,sourceAccountId:"bank",sourceCompanyId:"main",cashAccountId:"cash",throughCash:true,bankReviewId:null,originPaymentIds:[],allocations:[{id:"a",amount:5000,date:"2026-09-11",name:"Дивиденды",category:"Дивиденды",companyId:"kor",accountId:"korcash",counterparty:"Коровкин",excluded:false},{id:"b",amount:10000,date:"2026-09-15",name:"Дивиденды",category:"Дивиденды",companyId:"kor",accountId:"korcash",counterparty:"Коровкин",excluded:false}]};
let id=0;const entries=()=>buildChainEntries(draft,companies,()=>"id-"+id++);
test("linked bank facts balance individually and a missing later receipt remains visible",()=>{
 const pair="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const payment=entries()[0].payment;
 const out={...payment,amount:-55000,comment:`[dds-bank-transfer:${pair}]`};
 const incoming={...out,id:"incoming",amount:55000};
 assert.equal(ledgerTransferBalances([out,incoming]).linked[0].balanced,true);
 assert.equal(ledgerTransferBalances([out]).linked[0].net,-55000);
 assert.equal(ledgerTransferBalances([out]).linked[0].balanced,false);
 assert.equal(ledgerTransferBalances([out,incoming]).unlinked.length,0);
});
test("cash and loan transfers balance per part while ordinary expenses remain a real negative business result",()=>{
 const records=entries();assert.ok(paymentTransferBalances(records).every(group=>group.balanced));
 assert.equal(records.reduce((sum,e)=>sum+e.payment.amount,0),-15000);
 assert.ok(ledgerTransferBalances(records.map(e=>e.payment)).linked.every(group=>group.balanced));
});
test("a missing receipt or one kopeck difference names the exact loan and wallet",()=>{
 const records=entries();const receipt=records.find(e=>e.role==='loan-in'&&e.allocationId==='a')!;receipt.payment.amount-=.01;
 const issue=paymentTransferBalances(records).find(group=>!group.balanced)!;
 assert.equal(issue.id,'loan:a');assert.equal(issue.net,-.01);assert.equal(issue.entries[1].payment.accountId,'korcash');
 assert.equal(paymentTransferBalances(records.filter(e=>e!==receipt)).find(group=>!group.balanced)!.net,-5000);
});
test("opposite errors cannot compensate across allocations; cancelled counterparts are ignored",()=>{
 const records=entries();records.find(e=>e.role==='loan-in'&&e.allocationId==='a')!.payment.amount-=100;records.find(e=>e.role==='loan-in'&&e.allocationId==='b')!.payment.amount+=100;
 assert.deepEqual(paymentTransferBalances(records).filter(group=>!group.balanced).map(g=>g.net),[-100,100]);
 const cancelled=records.map(e=>({...e.payment,status:'cancelled' as const}));assert.equal(ledgerTransferBalances(cancelled).linked.length,0);
});
test("unlinked technical records show their real difference and a card transfer requires its receipt",()=>{
 const records=entries();const p={...records[0].payment,comment:undefined,amount:-55000,category:TRANSFER_CATEGORIES.outgoing};
 const income={...p,id:'receipt',amount:45000,category:TRANSFER_CATEGORIES.incoming};
 const result=ledgerTransferBalances([p,income,{...p,id:'salary',amount:-3000,category:'Зарплата административного персонала'}]);assert.equal(result.unlinkedNet,-10000);assert.equal(result.unlinked.length,2);
 const cardDraft={...draft,allocations:[{...draft.allocations[0],category:TRANSFER_CATEGORIES.outgoing,targetAccountId:'card'}]};const card=buildChainEntries(cardDraft,companies);assert.ok(paymentTransferBalances(card).every(g=>g.balanced));assert.equal(paymentTransferBalances(card.filter(e=>e.role!=='transfer-in')).find(g=>g.id==='wallet:a')!.net,-5000);
});
