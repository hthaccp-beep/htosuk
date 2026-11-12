export interface TrialLedger {
 schemaVersion:1; confirmedRemainingPence:number; confirmation:string; runLimitPence:number;
 requests:{id:string;reservedPence:number;state:'RESERVED'|'COMPLETE'|'UNCERTAIN';estimatedUsd?:number;inputTokens?:number;outputTokens?:number}[];
}
/** Reserve BEFORE dispatch; retain the reservation even on failure. The runner saves atomically under a file lock. */
export function reserveInvoiceTrial(current:TrialLedger,id:string,reservedPence=60):TrialLedger {
 if(current.schemaVersion!==1||!current.confirmation?.trim()||!Number.isSafeInteger(current.confirmedRemainingPence)||current.confirmedRemainingPence<0||!Number.isSafeInteger(current.runLimitPence)||current.runLimitPence<0||current.runLimitPence>200||!Array.isArray(current.requests))throw new Error('Confirm the remaining trial allowance before a paid request.');
 if(current.requests.some(r=>r.state!=='COMPLETE'))throw new Error('A previous request has uncertain usage. Reconcile it before another paid request.');
 if(!id||current.requests.some(r=>r.id===id))throw new Error('This trial request has already been reserved. Do not retry it.');
 if(!Number.isSafeInteger(reservedPence)||reservedPence<60)throw new Error('The conservative per-request reservation must be at least 60p.');
 const used=current.requests.reduce((sum,r)=>{if(!Number.isSafeInteger(r.reservedPence)||r.reservedPence<60)throw new Error('Invalid usage ledger.');return sum+r.reservedPence;},0);
 if(used+reservedPence>Math.min(current.confirmedRemainingPence,current.runLimitPence))throw new Error('The sample run has reached its approved spending cap.');
 return {...current,requests:[...current.requests,{id,reservedPence,state:'RESERVED'}]};
}
