import type {VercelRequest,VercelResponse} from '@vercel/node';
import {getAdmin} from '../firebase-admin.ts';
import {invoiceCaseAction} from '../../server/invoice-case-service.ts';
import {configuredInvoiceReader} from '../../server/invoice-reader-connection.ts';
import {InvoiceCaseError} from '../../server/invoice-case-validation.ts';

/** One durable section per authenticated request; no detached task or automatic retry. */
export default async function handler(req:VercelRequest,res:VercelResponse){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'POST required.'});
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return res.status(401).json({error:'Please sign in.'});
 if(req.body?.action!=='invoice-case-read')return res.status(400).json({error:'Choose an invoice reading action.'});
 if(process.env.HTOS_ENABLE_INVOICE_CASES!=='true'||process.env.HTOS_ENABLE_INVOICE_READING!=='true')return res.status(503).json({error:'Invoice reading is not enabled.'});
 try{
  const {auth,db}=getAdmin();let uid:string;
  try{uid=(await auth.verifyIdToken(token,true)).uid;}catch{return res.status(401).json({error:'Please sign in again.'});}
  const reader=configuredInvoiceReader(db,process.env,globalThis.fetch);
  return res.status(200).json(await invoiceCaseAction(db,uid,req.body,true,reader));
 }catch(e){return res.status(e instanceof InvoiceCaseError?e.status:503).json({error:e instanceof InvoiceCaseError?e.message:'Reading stopped. Check saved progress and usage before continuing; no automatic retry was made.'});}
}
