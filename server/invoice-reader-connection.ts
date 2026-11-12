import {externalServiceEnabled} from './htos-runtime.ts';
import {preparedInvoiceGate} from './invoice-prepared-gate.ts';
import {storedInvoicePreparationLoader} from './invoice-preparation-storage.ts';
import {firestoreSectionJobStore,type SectionReader} from './invoice-section-jobs.ts';
import {invoiceSectionProvider} from './invoice-section-provider.ts';
import type {Environment} from '../shared/htos-config.ts';
import type {InvoiceReadGate} from './invoice-case-reader.ts';
import {invoiceBudgetConfig,ensureInvoiceReadingBudget} from './invoice-reading-budget.ts';

/** Explicit server-only wiring; the browser cannot choose a budget, key, model or provider. */
export function storedInvoiceReader(db:any,budgetId:string,read:SectionReader):InvoiceReadGate{
 return {resumable:true,requiresPreparation:true,async read(documents,jobId){
  if(documents.length!==1)throw new Error('Choose one original document.');
  const source=documents[0],loader=await storedInvoicePreparationLoader(db,source.id,source.sha256,jobId);
  const gate=preparedInvoiceGate({store:firestoreSectionJobStore(db),budgetId,storedMetadataOnly:true,prepare:async()=>loader.plan,read:async(section,requestId)=>read(await loader.section(section),requestId)});
  return gate.read(documents,jobId);
 }};
}
export function configuredInvoiceReader(db:any,env:Environment,transport:typeof fetch){
 if(env.HTOS_ENABLE_INVOICE_CASES!=='true'||env.HTOS_ENABLE_INVOICE_READING!=='true'||!externalServiceEnabled('OCR',env))return undefined;
 const apiKey=env.HTOS_INVOICE_OPENAI_API_KEY,budgetId=env.HTOS_INVOICE_READING_BUDGET_ID;
 if(!apiKey?.startsWith('sk-')||!budgetId||!/^[\w-]{1,80}$/.test(budgetId))return undefined;
 const config=invoiceBudgetConfig(env);
 // Existing approved budgets remain supported; a new stage requires explicit server approval.
 const gate=storedInvoiceReader(db,budgetId,invoiceSectionProvider({apiKey,fetch:transport,timeoutMs:90000}));
 return {...gate,async read(documents,jobId){
  if(config)await ensureInvoiceReadingBudget(db,config);
  return gate.read(documents,jobId);
 }} satisfies InvoiceReadGate;
}
