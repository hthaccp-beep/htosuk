import {createHash} from 'node:crypto';
import {InvoiceReadingPending,type InvoiceReadGate} from './invoice-case-reader.ts';
import {runInvoiceSectionStep,type PreparedInvoiceJob,type SectionJobStore,type SectionReader} from './invoice-section-jobs.ts';

/** Preparation, budget and reader are server-owned dependencies; never selected by browser request fields. */
export function preparedInvoiceGate(options:{store:SectionJobStore;budgetId:string;prepare:(hash:string,documentId:string,jobId:string)=>Promise<PreparedInvoiceJob>;read:SectionReader;storedMetadataOnly?:boolean}):InvoiceReadGate {
 return {resumable:true,async read(documents,jobId){
  if(documents.length!==1)throw new Error('Choose one original document.');
  const doc=documents[0];if(createHash('sha256').update(Buffer.from(doc.base64,'base64')).digest('hex')!==doc.sha256)throw new Error('Original document integrity failed.');
  const plan=await options.prepare(doc.sha256,doc.id,jobId);if(plan.documentHash!==doc.sha256)throw new Error('Prepared image belongs to another original.');
  const step=await runInvoiceSectionStep(options.store,jobId,options.budgetId,plan,options.read,options.storedMetadataOnly===true);
  if(step.state==='PAUSED')throw new InvoiceReadingPending(step.completed,step.total);
  return step.result;
 }};
}
