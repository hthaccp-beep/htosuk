import {sampleReviewed} from './invoice-workflow.ts';
import {invoiceLineNetPence} from '../../shared/invoice-case.ts';
export function itemReviewSample(){const r=sampleReviewed();
 r.id='DEMO-ITEM-REVIEW';r.invoiceReference='SAMPLE-ITEMS-001';
 r.lines[0].invoicePrice=18;r.lines[1].invoicePrice=21;
 r.invoiceNetPence=r.lines.reduce((s,l)=>s+invoiceLineNetPence(l)!,0);r.invoiceGrossPence=r.invoiceNetPence;
 r.claim={id:'sample-claim',revision:1,state:'SENT',recipient:'',subject:'Sample claim',message:'',lines:[{lineId:r.lines[0].id,quantity:2,netPence:3600,creditedPence:0,replacementPence:0,reason:'Two bags missing'},{lineId:r.lines[1].id,quantity:1,netPence:2800,creditedPence:800,replacementPence:0,reason:'One case missing and price higher'},{lineId:r.lines[2].id,quantity:1,netPence:1200,creditedPence:0,replacementPence:1200,reason:'One damaged case replaced'},{lineId:r.lines[3].id,quantity:2,netPence:750,creditedPence:750,replacementPence:0,reason:'Two damaged packs fully credited'}]};
 r.laterDeliveryIds=['sample-pending','sample-confirmed'];r.laterReceipts=[{deliveryId:'sample-pending',allocationId:'p',lineId:r.lines[0].id,issueId:'missing-rice',purpose:'REPLACEMENT',quantity:2,status:'PENDING'},{deliveryId:'sample-confirmed',allocationId:'c',lineId:r.lines[2].id,issueId:'damaged-soy',purpose:'REPLACEMENT',quantity:1,status:'APPROVED',settledPence:1200}];
 return r;
}
