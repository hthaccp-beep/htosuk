import type {InvoiceCase} from './invoice-case.ts';
export type LaterAllocation={id:string;caseId:string;lineId:string;issueId?:string;purpose:'REPLACEMENT'|'NEW_ORDER';quantity:number;billedQuantity?:number;billing?:'NO_EXTRA_CHARGE'|'ALREADY_CREDITED'|'NOT_PREVIOUSLY_CHARGED';reason?:string};
export type LaterRow={id:string;reference:string;description:string;quantity:number;allocations:LaterAllocation[];billedQuantity?:number;unitPrice?:number};
export type LaterDocument={caseId:string;documentId:string};
export type LaterDelivery={id:string;hostCaseId:string;caseIds:string[];version:number;branchId:string;supplierId:string;mode:'SEPARATE'|'COMBINED';reference:string;date:string;documents:LaterDocument[];rows:LaterRow[];status:'DRAFT'|'SUBMITTED'|'APPROVED';readable:boolean;receiptConfirmed:boolean;notes:string;returnReason?:string;createdAt:string;createdBy:string;submittedAt?:string;submittedBy?:string;approvedAt?:string;approvedBy?:string;requests:string[];audit:{at:string;by:string;action:string;notes:string}[]};
export type LaterReceipt={deliveryId:string;allocationId:string;lineId:string;issueId?:string;purpose:'REPLACEMENT'|'NEW_ORDER';quantity:number;status:'PENDING'|'APPROVED';settledPence?:number;creditBasisPence?:number;newChargePence?:number};
export function outstandingIssue(record:InvoiceCase,issueId:string,excludeDeliveryId?:string){const issue=record.receipt.issues.find(i=>i.id===issueId);if(!issue||!['MISSING','DAMAGED','INCORRECT','OUT_OF_STOCK'].includes(issue.kind))return 0;return Math.max(0,(issue.quantity||0)-(record.laterReceipts||[]).filter(r=>r.issueId===issueId&&r.deliveryId!==excludeDeliveryId).reduce((s,r)=>s+r.quantity,0));}
export function blankLaterDelivery(host:InvoiceCase,id:string,at:string,by:string):LaterDelivery{return {id,hostCaseId:host.id,caseIds:[host.id],version:0,branchId:host.branchId,supplierId:host.supplierId,mode:'SEPARATE',reference:'',date:at.slice(0,10),documents:[],rows:[],status:'DRAFT',readable:false,receiptConfirmed:false,notes:'',createdAt:at,createdBy:by,requests:[],audit:[]};}
export function laterCaseIds(event:LaterDelivery){return [...new Set([event.hostCaseId,...event.documents.map(d=>d.caseId),...event.rows.flatMap(r=>r.allocations.map(a=>a.caseId))])];}
export function staffLaterDelivery(event:LaterDelivery):LaterDelivery{return {...event,rows:event.rows.map(r=>({id:r.id,reference:r.reference,description:r.description,quantity:r.quantity,allocations:r.allocations.map(({id,caseId,lineId,issueId,purpose,quantity})=>({id,caseId,lineId,issueId,purpose,quantity}))}))};}

export function canReportLaterDelivery(record:InvoiceCase){return !!record.receipt.submittedAt&&record.receipt.issues.some(i=>!!i.lineId&&outstandingIssue(record,i.id)>0);}

/** Use one explicit wire shape for the editor and service-boundary tests. */
export function laterDeliveryCommand(event:LaterDelivery,cases:Record<string,InvoiceCase>,kind:string,requestId:string,verified=false,reason=''){
 return {kind,requestId,expectedVersion:event.version,caseVersions:Object.fromEntries(Object.values(cases).map(c=>[c.id,c.version])),
  ...(kind==='save'||kind==='submit'?{event}:kind==='approve'?{rows:event.rows,verified}:{reason})};
}
