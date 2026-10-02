import test from "node:test";
import assert from "node:assert/strict";
import {allocateWalletFunding,allocationTotal,autofillPaymentChainCash,bankReviewSpendingSplits,buildChainEntries,chainCashAccounts,chainRemainder,chainMetadata,encodeChainMetadata,isLegacyPaymentSplit,isMainGroup,preferredChainCashAccount,requiresFilippovLoan,validateChain,chainIdForPayment,type PaymentChainDraft} from "./paymentChains.ts";
import {DDS_CATEGORIES} from "./categories.ts";
import type {Account} from "../types.ts";
const companies=[{id:'main',name:'ИП Митриченко',groupName:'Основная группа'},{id:'kor',name:'ИП Коровкин',groupName:'Коровкин'},{id:'fil',name:'ИП Филиппов',groupName:'Коровкин'},{id:'other',name:'ООО Другая',groupName:'Отдельная'}];
const accounts=[{id:'bank',name:'Точка',type:'bank'},{id:'cash',name:'Наличные группы',type:'cash'},{id:'korcash',name:'Наличные Коровкина',type:'cash'},{id:'filbank',name:'ИП Филиппов Точка',type:'bank'}].map(a=>({...a,currency:'RUB',balance:0}) as Account);
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
 assert.equal(requiresFilippovLoan(companies[0],companies[2]),true);
 assert.equal(requiresFilippovLoan(companies[2],companies[0]),true);
 assert.equal(requiresFilippovLoan(companies[3],companies[1]),false);
 assert.equal(requiresFilippovLoan(companies[1],companies[1]),false);
});
test('Filippov account paying an expense of the main group creates the reverse loan automatically',()=>{
 const d=draft();d.sourceCompanyId='fil';d.sourceAccountId='filbank';d.cashAccountId='korcash';d.sourceAmount=1976.55;
 d.allocations=[{...d.allocations[0],id:'main-expense',amount:1976.55,companyId:'main',accountId:'cash',category:'Дивиденды'}];
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 const rows=entries(d);
 assert.deepEqual(rows.map(row=>row.role),['source','cash-in','loan-out','loan-in','spending']);
 assert.equal(rows[2].payment.companyId,'fil');
 assert.equal(rows[3].payment.companyId,'main');
});
test('personal wallet expense consumes several partial top-ups from the same economic owner',()=>{
 const links=allocateWalletFunding([
  {chainId:'a',allocationId:'one',companyId:'main',amount:1000,date:'2026-09-01'},
  {chainId:'b',allocationId:'two',companyId:'main',amount:1500,date:'2026-09-02'},
 ],1976.55);
 assert.deepEqual(links?.map(link=>link.amount),[1000,976.55]);
 assert.equal(allocateWalletFunding([
  {chainId:'a',allocationId:'one',companyId:'main',amount:1000,date:'2026-09-01'},
  {chainId:'b',allocationId:'two',companyId:'fil',amount:1500,date:'2026-09-02'},
 ],1976.55),null,'mixed owners require an explicit review instead of guessing');
});
test('cash wallets are autofilled for the real Pankratov to Filippov chain and calendar wallet is ignored',()=>{
 const realAccounts=[
  {id:'plan',name:'PANKSTER GROUP',type:'cash',currency:'RUB',balance:0},
  {id:'shared',name:'Наличка',type:'cash',currency:'RUB',balance:0},
  {id:'illumey',name:'Наличка Иллюмей',type:'cash',currency:'RUB',balance:0},
  {id:'pankratov',name:'Наличка ИП Панкратов',type:'cash',currency:'RUB',balance:0},
 ] as Account[];
 const realCompanies=[{id:'pankratov',name:'ИП Панкратов',groupName:'Основная группа'},{id:'filippov',name:'ИП Филиппов',groupName:'ИП Филиппов'},{id:'illumey',name:'ООО Иллюмей',groupName:'Основная группа'}];
 assert.deepEqual(chainCashAccounts(realAccounts).map(account=>account.id),['shared','illumey','pankratov']);
 assert.equal(preferredChainCashAccount(realCompanies[0],realAccounts,realCompanies)?.id,'pankratov');
 assert.equal(preferredChainCashAccount(realCompanies[1],realAccounts,realCompanies)?.id,'shared');
 const auto=autofillPaymentChainCash({id:'chain',revision:0,label:'Оплата по счёту',sourceDate:'2026-09-23',sourceAmount:999685,sourceAccountId:'bank',sourceCompanyId:'pankratov',cashAccountId:'',throughCash:false,bankReviewId:'review',originPaymentIds:[],allocations:[{id:'part',amount:999685,date:'2026-09-23',name:'Оплата по счёту',category:'Закуп товара',companyId:'filippov',accountId:'bank',counterparty:'ИП Доан Ха Ли',excluded:false}]},realCompanies,realAccounts);
 assert.equal(auto.throughCash,true);
 assert.equal(auto.cashAccountId,'pankratov');
 assert.equal(auto.allocations[0].accountId,'shared');
 assert.deepEqual(validateChain(auto,[{id:'bank',name:'ИП Панкратов ОЗОН банк',type:'bank',currency:'RUB',balance:0},...realAccounts],realCompanies,DDS_CATEGORIES),[]);
});
test('all legal entities of the main contour stay inside one group without loans',()=>{
 const names=['ООО РИО','ИП Кучеренко','ИП Панкратов','ООО ГЛОБАЛКОС','ИП Митриченко','ООО Иллюмей'];
 for(const [index,name] of names.entries()) {
  const company={id:`main-${index}`,name,groupName:'Основная группа'};
  assert.equal(isMainGroup(company),true,name);
  assert.equal(requiresFilippovLoan(company,{id:'other-main',name:'ИП Панкратов',groupName:'Основная группа'}),false,name);
 }
});
test('technical loan rows do not multiply the source amount in the split editor',()=>{
 const rows=[
  {amount:200000,category:'Выдача кредитов и займов',flow:'expense' as const,countsTowardBank:true},
  {amount:200000,category:'Получение кредитов и займов',flow:'income' as const,countsTowardBank:false},
  {amount:200000,category:'Дивиденды',flow:'expense' as const,countsTowardBank:false},
 ];
 assert.deepEqual(bankReviewSpendingSplits(rows),[rows[2]]);
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
test('an unknown expense can stay without a category for later classification',()=>{
 const d=draft();d.allocations[2]={...d.allocations[2],amount:50000,category:''};d.sourceAmount=75000;
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 assert.equal(entries(d).at(-1)?.payment.category,'');
});
test('validation identifies the exact split row and an invalid category',()=>{
 const d=draft();d.allocations[2]={...d.allocations[2],amount:50000,category:'Несуществующая статья'};d.sourceAmount=75000;
 const errors=validateChain(d,accounts,companies,DDS_CATEGORIES);
 assert.deepEqual(errors,['Часть 3, 50 000 ₽: укажите допустимую статью']);
});
test('excluded parts do not create loans or expenses; malformed metadata does not pretend to be a chain',()=>{
 const d=draft();d.allocations[2].excluded=true;assert.equal(entries(d).length,4);
 assert.equal(chainMetadata('[dds-chain:garbage]'),null);
 const meta={id:'chain',revision:2,amount:55000,date:'2026-09-10',label:'Наличные [сентябрь]',role:'source' as const};
 assert.deepEqual(chainMetadata(encodeChainMetadata(meta,'[calendar-fact:abc] пояснение')),meta);
 assert.match(encodeChainMetadata(meta,'[calendar-fact:abc]'),/calendar-fact:abc/);
});
test('excluded part is NOT counted as already distributed — allocationTotal/remainder stay honest',()=>{
 // Дивиденды (30000) исключены — buildChainEntries для них не создаёт ни
 // одной записи (проверено тестом выше). allocationTotal раньше засчитывал
 // их как распределённые (5000+10000+30000=45000, остаток 10000 — как будто
 // ничего не изменилось), хотя реально распределено только 15000, а 40000
 // (10000 остаток + 30000 исключённое) нигде не проведены.
 const d=draft();d.allocations[2].excluded=true;
 assert.equal(allocationTotal(d),15000,'исключённая часть не должна считаться распределённой');
 assert.equal(chainRemainder(d),40000,'остаток обязан честно показывать и невыделенное, и исключённое');
});
test('excluded part on a non-cash chain blocks saving with an honest remainder, not a silent success',()=>{
 // Банковская выписка на -100000 без наличных (throughCash=false, прямой
 // расход со счёта источника): разносим 60000 обычной частью, 40000 —
 // «не включать в ДДС». Раньше exclude 40000 проходил валидацию
 // (allocationTotal их засчитывал как распределённые), а buildChainEntries
 // эту сумму просто не проводил — 40000 ₽ реального банковского оттока
 // переставали существовать где-либо в ДДС, без единой ошибки при сохранении.
 const d=draft();d.throughCash=false;d.sourceAmount=100000;d.cashAccountId='';
 d.allocations=[
  {id:'a',amount:60000,date:'2026-09-10',name:'Обычная часть',category:'Прочие расходы',companyId:'main',accountId:'bank',counterparty:'',excluded:false},
  {id:'b',amount:40000,date:'2026-09-10',name:'Не включать',category:'',companyId:'',accountId:'',counterparty:'',excluded:true},
 ];
 const errors=validateChain(d,accounts,companies,DDS_CATEGORIES);
 assert.match(errors.join(' '),/Распределите исходную сумму полностью/,'исключённая часть должна требовать довести остаток до нуля, а не проходить молча');
 assert.equal(chainRemainder(d),40000);
});
test('excluding a part is still valid when routed through cash — the full source amount is a real payment either way',()=>{
 // throughCash=true уже И ДО фикса не требовал remainder===0 (наличные
 // сами по себе — легитимный "карман" для ещё не разнесённой суммы). Важно,
 // что buildChainEntries.source по-прежнему проводит ПОЛНУЮ sourceAmount —
 // исключённая часть не вычитает деньги из банковского оттока, только не
 // создаёт для них отдельную статью расхода.
 const d=draft();d.allocations[2].excluded=true;
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[],'наличные — легитимный способ оставить часть неразнесённой');
 const rows=entries(d);
 const source=rows.find(e=>e.role==='source')!;
 assert.equal(source.payment.amount,-55000,'вся банковская сумма уходит в наличные независимо от исключённых частей');
});

test('transfer to a card has its matching incoming entry and does not masquerade as an expense',()=>{
 const d=draft();d.allocations[2]={...d.allocations[2],category:'Выбытие — Перевод между счетами',targetAccountId:'bank'};
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 const rows=entries(d);assert.equal(rows.at(-1)?.role,'transfer-in');assert.equal(rows.at(-1)?.payment.amount,30000);
 assert.equal(rows.reduce((sum,e)=>sum+e.payment.amount,0),-15000);
 d.allocations[2].targetAccountId='';assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/кошелёк поступления/);
});

test('bank-review chain requires an incoming statement row for a transfer to Filippov bank',()=>{
 const d=draft();d.bankReviewId='source-review';d.sourceAmount=300000;d.allocations=[{...d.allocations[2],amount:300000,category:'Выбытие — Перевод между счетами',targetAccountId:'filbank'}];
 assert.match(validateChain(d,accounts,companies,DDS_CATEGORIES).join(' '),/встречное поступление из выписки/);
 d.allocations[0].targetReviewId='incoming-review';
 assert.deepEqual(validateChain(d,accounts,companies,DDS_CATEGORIES),[]);
 const rows=entries(d);assert.equal(rows.at(-1)?.role,'transfer-in');assert.equal(rows.at(-1)?.payment.accountId,'filbank');
});

test('one bank payment is not listed as a split operation',()=>{
 assert.equal(isLegacyPaymentSplit([{id:'whole'}]),false);
 assert.equal(isLegacyPaymentSplit([{id:'first'},{id:'second'}]),true);
});
