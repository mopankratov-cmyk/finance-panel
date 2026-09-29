import test from "node:test";
import assert from "node:assert/strict";
import { economicCompanyId, expenseOwnerSplits, reconcileSimpleExpenseOwner } from "./bankReviewExpenseOwner.ts";
import { decodeBankSplits, encodeBankSplits, type BankInstructionSplit } from "./bankInstructionSplits.ts";
import type { BankReviewItem } from "./bankReviewStore.ts";

const companies = [
  {id:"pankratov",name:"ИП Панкратов",groupName:"Основная группа",isActive:true},
  {id:"mitrichenko",name:"ИП Митриченко",groupName:"Основная группа",isActive:true},
  {id:"filippov",name:"ИП Филиппов",groupName:"ИП Филиппов",isActive:true},
];
const item = (patch: Partial<BankReviewItem> = {}): BankReviewItem => ({
  id:"review",batchId:"batch",documentHash:"hash",sourceFileName:"statement.xlsx",externalId:"external",
  date:"2026-09-17",amount:-10000,bankAccountNumber:"2301",ownerInn:"",companyId:"pankratov",accountId:"bank",
  counterparty:"Андрей Коровкин",counterpartyInn:"",purpose:"Перевод собственных средств",category:"Дивиденды",
  confidence:0,reasons:[],status:"ready",matchedTransferId:null,managerQuestion:null,managerAnswer:null,paymentComment:"",...patch,
});
const split = (patch: Partial<BankInstructionSplit> = {}): BankInstructionSplit => ({
  id:"expense",amount:10000,description:"Дивиденды",category:"Дивиденды",companyId:"pankratov",accountId:"bank",
  flow:"expense",countsTowardBank:true,excluded:false,needsClarification:false,...patch,
});

test("Коровкин автоматически выбирает отдельный контур Филиппова",()=>{
  assert.equal(economicCompanyId(item(),companies),"filippov");
  const reconciled=reconcileSimpleExpenseOwner(item({managerAnswer:encodeBankSplits([split()])}),companies);
  assert.equal(decodeBankSplits(reconciled.managerAnswer)?.[0].companyId,"filippov");
});

test("Митриченко и Панкратов остаются внутри основной группы без займа",()=>{
  const stale=[
    split({category:"Выдача кредитов и займов",companyId:"mitrichenko"}),
    split({id:"final",companyId:"filippov",countsTowardBank:false}),
  ];
  const source=item({companyId:"mitrichenko",counterparty:"Максим Панкратов",managerAnswer:encodeBankSplits(stale)});
  const reconciled=reconcileSimpleExpenseOwner(source,companies);
  const rows=decodeBankSplits(reconciled.managerAnswer)!;
  assert.equal(rows.length,1);
  assert.equal(rows[0].companyId,"mitrichenko");
});

test("у любого расхода можно указать другую компанию",()=>{
  const rows=expenseOwnerSplits(item({amount:-999685,counterparty:"ИП Доан Ха Ли"}),"filippov");
  assert.equal(rows.length,1);
  assert.equal(rows[0].amount,999685);
  assert.equal(rows[0].companyId,"filippov");
  assert.equal(rows[0].countsTowardBank,true);
});
