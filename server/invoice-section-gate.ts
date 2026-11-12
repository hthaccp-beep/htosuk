import {createHash} from 'node:crypto';
import {invoiceFromSections,type InvoiceSectionBundle} from '../shared/invoice-section-extraction.ts';
import type {InvoiceReadGate} from './invoice-case-reader.ts';

/** Connect a trusted, already-completed section job to the existing worker. Never accepts browser-supplied readings or dispatches AI. */
export function savedSectionInvoiceGate(load:(jobId:string,documentHash:string)=>Promise<InvoiceSectionBundle>):InvoiceReadGate {
 return {async read(documents,jobId){
  if(documents.length!==1)throw new Error('Choose one original document.');
  const doc=documents[0],bytes=Buffer.from(doc.base64,'base64');
  if(bytes.toString('base64')!==doc.base64||createHash('sha256').update(bytes).digest('hex')!==doc.sha256)throw new Error('Original document integrity failed.');
  const bundle=await load(jobId,doc.sha256);
  return {draft:invoiceFromSections(bundle,doc.sha256),usage:{inputTokens:0,outputTokens:0,estimatedUsd:0},responseId:'saved-sections-'+jobId,model:'saved-section-results'};
 }};
}
