import React,{useState} from 'react';
import type {InvoiceCase} from '../../shared/invoice-case';
import {uploadInvoicePreparation} from '../../shared/invoice-preparation';
import {InvoicePhotoPreparation} from './InvoicePhotoPreparation';
import {useCheckWorkflow} from './CheckWorkflow';

export function InvoiceStoredPreparation({record,documentId,disabled,onDirty,onSaved}:{record:InvoiceCase;documentId:string;disabled:boolean;onDirty:(dirty:boolean)=>void;onSaved:()=>void}){
 const request=useCheckWorkflow(),[progress,setProgress]=useState('');
 const load=async()=>{const d=await request({action:'invoice-case-document',caseId:record.id,documentId});if(!['image/jpeg','image/png'].includes(d.mime))throw new Error('Choose an uploaded JPEG or PNG photo.');const bytes=Uint8Array.from(atob(d.base64),(c:string)=>c.charCodeAt(0));return new File([bytes],d.name,{type:d.mime});};
 return <div><InvoicePhotoPreparation sampleFile={load} sourceLabel="Prepare uploaded photo" disabled={disabled} onDirty={onDirty} onConfirmed={async photo=>{
  const document=record.documents.find(d=>d.id===documentId);if(photo.plan.documentHash!==document?.sha256)throw new Error('Original photo changed. Reload before saving.');
  await uploadInvoicePreparation(request,{caseId:record.id,documentId,expectedVersion:record.version},photo.plan,(saved,total)=>setProgress(`Saving prepared photo: ${saved} of ${total} parts`));
  setProgress('Prepared photo saved.');onDirty(false);onSaved();
 }}/>{progress&&<p role="status">{progress}</p>}</div>;
}
