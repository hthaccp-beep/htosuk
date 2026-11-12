import type {Environment} from '../shared/htos-config.ts';

/** A server-configured, explicitly approved stage. Never accept amounts from browser requests. */
export function invoiceBudgetConfig(env:Environment){
 const id=env.HTOS_INVOICE_READING_BUDGET_ID,raw=env.HTOS_INVOICE_READING_CAP_PENCE,approval=env.HTOS_INVOICE_READING_BUDGET_APPROVAL;
 if(!id||!/^[\w-]{1,80}$/.test(id)||!raw||!/^\d{1,7}$/.test(raw)||!approval||!/^[\w .:-]{8,160}$/.test(approval))return null;
 const capPence=Number(raw);if(!Number.isSafeInteger(capPence)||capPence<1||capPence>1000000)return null;
 return {id,capPence,approval};
}

export async function ensureInvoiceReadingBudget(db:any,config:NonNullable<ReturnType<typeof invoiceBudgetConfig>>){
 const ref=db.collection('_invoice_read_jobs').doc('budget-'+config.id);
 return db.runTransaction(async(tx:any)=>{
  const snap=await tx.get(ref);
  if(snap.exists){
   const budget=snap.data();
   if(budget.approved!==true||budget.capPence!==config.capPence||budget.approval!==config.approval||!Number.isSafeInteger(budget.allocatedPence)||budget.allocatedPence<0)throw new Error('Reading budget configuration differs from its approval. No allowance was reset.');
   return budget;
  }
  const budget={approved:true,capPence:config.capPence,allocatedPence:0,approval:config.approval,approvedAt:new Date().toISOString()};
  tx.set(ref,budget);return budget;
 });
}
