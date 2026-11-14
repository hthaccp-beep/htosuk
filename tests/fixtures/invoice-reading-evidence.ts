import {extractionFixture} from './invoice-extraction.ts';
import type {ReadingEvidence} from '../../server/invoice-reading-evidence.ts';
export function evidenceFixture(){
 const invoice={...extractionFixture(),customerName:'Sample Restaurant 7'};
 const evidence:ReadingEvidence={identityBlocks:[
  {page:1,role:'SUPPLIER',name:invoice.supplier,location:'Supplier Road',locationKind:'UNLABELLED',roleEvidence:'Issuer heading and VAT block'},
  {page:1,role:'CUSTOMER',name:invoice.customerName,location:invoice.branch,locationKind:'DELIVERY',roleEvidence:'Deliver to'},
 ],rowWitnesses:invoice.rows.map((r,i)=>({page:r.page,row:r.row,description:r.description,previousPrintedLabel:invoice.rows[i-1]?.description??null,nextPrintedLabel:invoice.rows[i+1]?.description??null,alignment:'CLEAR'}))};
 return {...evidence,invoice};
}
