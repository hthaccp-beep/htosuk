import {hasKnownAgreedPrice} from './invoice-item-review.ts';
import {invoiceComparison} from './invoice-comparison.ts';
import {currentExtraReviews,hasConfirmedExtraReview} from './invoice-unit-review.ts';
import {lineDiscrepancy,type InvoiceCase} from './invoice-case.ts';
import type {Product} from '../types.ts';

export type SimpleTableMark='DONE'|'FOLLOW';
export type SimpleIssueTheme='price'|'detail'|'qty'|'matched';

export interface SimpleOrderedRow {
 kind:'ORDERED';
 id:string;
 lineId:string;
 orderNo:number;
 orderProductId:string;
 orderProductName:string;
 orderPrice?:number;
 orderQty:number;
 orderUnit:string;
 receiveNo:string;
 receiveProductId:string;
 receiveProductName:string;
 receivePrice?:number;
 receiveQty?:number;
 receiveBilledQty?:number;
 receiveUnit:string;
 statusLabel:string;
 statusTone:'ok'|'warn'|'danger';
 issueTheme:SimpleIssueTheme;
 priceDiffers:boolean;
 codeDiffers:boolean;
 nameDiffers:boolean;
 qtyDiffers:boolean;
 unitCheckRequired:boolean;
 unitNote?:string;
 detailMismatch:boolean;
 mismatchReasons:string[];
 defaultMark:SimpleTableMark;
 creditEstimatePence:number;
}

export interface SimpleUnmatchedRow {
 kind:'UNMATCHED';
 id:string;
 page:number;
 row:number;
 receiveNo:string;
 receiveProductId:string;
 receiveProductName:string;
 receivePrice?:number;
 receiveQty?:number;
 receiveUnit:string;
 statusLabel:string;
 suggestedName?:string;
 suggestedLineId?:string;
 savedDecision?:'LEAVE_UNMATCHED'|'SUPPLIER_ITEM';
 savedProductId?:string;
 savedReason?:string;
 defaultMark:SimpleTableMark;
 lineAmountPence:number;
}

export interface SimpleInvoiceTableModel {
 ordered:SimpleOrderedRow[];
 unmatched:SimpleUnmatchedRow[];
 supplierOptions:{id:string;code:string;name:string;price?:number;unit:string}[];
 summary:{totalLines:number;followCount:number;doneCount:number;unmatchedCount:number;estimatedClaimPence:number};
}

export interface TableTotalsCheck {
 orderedLineBilledSumPence:number;
 allOrderedBilledKnown:boolean;
 unmatchedExtraSumPence:number;
 expectedNetWithAdjustmentPence:number;
 netPlusVatMatchesGross:boolean;
 linesPlusAdjustmentMatchesNet:boolean;
 differenceToNetPence?:number;
}

const norm=(value:string|undefined)=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();

export function buildSimpleInvoiceTable(record:InvoiceCase,catalogProducts:Product[]):SimpleInvoiceTableModel{
 const compared=invoiceComparison(record);
 const extraReviews=currentExtraReviews(record);
 const ordered:SimpleOrderedRow[]=[];
 const unmatched:SimpleUnmatchedRow[]=[];

 let orderIndex=0;
 let unmatchedIndex=0;

 for(const r of compared){
  const reading=r.readings?.[0];
  if(r.lineId){
   orderIndex++;
   const line=record.lines.find(l=>l.id===r.lineId)!;
   const issues=record.receipt.issues.filter(i=>i.lineId===r.lineId);
   const disc=lineDiscrepancy(record,line);

   const priceDisplay=r.priceDisplay??line.invoicePrice;
   const billedDisplay=r.billedDisplay??line.invoiceQuantity;
   const priceDiffers=hasKnownAgreedPrice(r.expectedPrice)&&priceDisplay!=null&&Math.round(r.expectedPrice*100)!==Math.round(priceDisplay*100);
   const codeDiffers=Boolean(reading?.code&&line.code&&norm(reading.code)!==norm(line.code));
   const nameDiffers=Boolean(reading?.name&&norm(reading.name)!==norm(line.name));
   const unitCheckRequired=Boolean(r.unitCheckRequired);
   const detailMismatch=priceDiffers||codeDiffers||nameDiffers||r.differingWording.length>0||unitCheckRequired;

   const hasDamage=issues.some(i=>i.kind==='DAMAGED');
   const hasMissing=issues.some(i=>i.kind==='MISSING')||(r.received!=null&&r.received<line.ordered&&!issues.some(i=>i.kind==='OUT_OF_STOCK'));
   const hasOutOfStock=issues.some(i=>i.kind==='OUT_OF_STOCK');
   const hasIncorrect=issues.some(i=>i.kind==='INCORRECT');
   const qtyDiffers=hasDamage||hasMissing||hasOutOfStock||hasIncorrect||(r.received!=null&&r.received!==line.ordered)||(billedDisplay!=null&&billedDisplay!==line.ordered);

   const mismatchReasons:string[]=[];
   if(priceDiffers&&r.expectedPrice!=null&&priceDisplay!=null){
    const diffPence=Math.round((priceDisplay-r.expectedPrice)*100);
    mismatchReasons.push(`Price ${diffPence>=0?'+':'−'}£${(Math.abs(diffPence)/100).toFixed(2)}`);
   }
   if(codeDiffers)mismatchReasons.push(`ID ${line.code} vs ${reading?.code}`);
   if(nameDiffers)mismatchReasons.push('Name differs');
   const rawReadingUnit=reading?.unit?.trim();
   const isUnitUnclear=!rawReadingUnit||norm(rawReadingUnit)==='unit unclear';
   const unitNote=unitCheckRequired
    ?(isUnitUnclear?`Unit unclear (ordered ${line.unit})`:norm(rawReadingUnit)!==norm(line.unit)?`Invoice unit ${rawReadingUnit} vs ${line.unit}`:'Confirm pack / unit')
    :undefined;
   if(unitNote)mismatchReasons.push(unitNote);

   const statusParts:string[]=[];
   if(hasDamage){
    const dmgQty=issues.filter(i=>i.kind==='DAMAGED').reduce((s,i)=>s+(i.quantity||0),0);
    statusParts.push(dmgQty?`Damage (${dmgQty})`:'Damage');
   }
   if(hasMissing){
    const missQty=issues.filter(i=>i.kind==='MISSING').reduce((s,i)=>s+(i.quantity||0),0)||Math.max(0,line.ordered-(r.received??line.ordered));
    statusParts.push(missQty?`Missing (${missQty})`:'Missing');
   }
   if(hasOutOfStock)statusParts.push('Out of stock');
   if(hasIncorrect)statusParts.push('Incorrect');
   if(priceDiffers)statusParts.push('Price');
   if(codeDiffers||nameDiffers)statusParts.push('ID / Name');
   if(unitCheckRequired)statusParts.push('Pack / Unit');
   const allQuantitiesAndPriceAgree=!detailMismatch&&!unitCheckRequired&&hasKnownAgreedPrice(r.expectedPrice)&&priceDisplay!=null&&Math.round(r.expectedPrice*100)===Math.round(priceDisplay*100)&&billedDisplay!=null&&billedDisplay===line.ordered&&r.received===line.ordered;
   if(!statusParts.length){
    if(r.suggestedMatch)statusParts.push('Confirm match');
    else if(r.matches)statusParts.push('Matched');
    else if(allQuantitiesAndPriceAgree)statusParts.push(reading?'AI matched (confirm)':'Matched');
    else if(r.received==null&&billedDisplay==null)statusParts.push('To check');
    else statusParts.push(r.result==='Checks complete'?'Matched':r.result);
   }

   const isAiCleanMatch=statusParts.length===1&&(statusParts[0]==='AI matched (confirm)'||statusParts[0]==='Matched'&&allQuantitiesAndPriceAgree);
   const isResolvedAccept=line.reviewed&&line.resolution==='ACCEPT'&&!detailMismatch&&!hasDamage&&!hasMissing&&!hasIncorrect;
   const hasFollowIssue=statusParts.some(s=>s!=='Matched'&&s!=='AI matched (confirm)')||line.resolution==='CLAIM'||line.resolution==='HOLD';
   const defaultMark:SimpleTableMark=(isResolvedAccept||isAiCleanMatch||(!hasFollowIssue&&!r.attention&&!unitCheckRequired))?'DONE':'FOLLOW';
   const statusTone:SimpleOrderedRow['statusTone']=hasDamage||hasMissing||hasIncorrect?'danger':isAiCleanMatch?'ok':(detailMismatch||hasOutOfStock||defaultMark==='FOLLOW')?'warn':'ok';
   const issueTheme:SimpleIssueTheme=hasDamage||hasMissing||hasIncorrect||hasOutOfStock?'qty':priceDiffers?'price':codeDiffers||nameDiffers||r.differingWording.length>0||unitCheckRequired?'detail':'matched';

   let creditEstimatePence=disc.known?disc.totalPence:0;
   const canEstimateFallback=!disc.known&&!unitCheckRequired&&!r.readingStale&&!r.suggestedMatch&&priceDisplay!=null&&billedDisplay!=null;
   if(canEstimateFallback){
    const badQty=issues.filter(i=>i.kind==='DAMAGED'||i.kind==='INCORRECT').reduce((s,i)=>s+(i.quantity||0),0);
    const usableQty=r.received!=null?Math.max(0,r.received-badQty):billedDisplay;
    const qtyDiff=Math.max(0,billedDisplay-usableQty);
    const qtyPence=Math.round(qtyDiff*priceDisplay*100);
    const priceOver=hasKnownAgreedPrice(line.expectedPrice)?Math.max(0,priceDisplay-line.expectedPrice):0;
    const pricePence=Math.round(Math.min(usableQty,billedDisplay)*priceOver*100);
    creditEstimatePence=qtyPence+pricePence;
   }

   ordered.push({
    kind:'ORDERED',
    id:r.id,
    lineId:line.id,
    orderNo:orderIndex,
    orderProductId:line.code||'—',
    orderProductName:line.name,
    orderPrice:hasKnownAgreedPrice(line.expectedPrice)?line.expectedPrice:undefined,
    orderQty:line.ordered,
    orderUnit:line.unit,
    receiveNo:reading?String(reading.row):String(orderIndex),
    receiveProductId:reading?.code||line.code||'—',
    receiveProductName:reading?.name||(billedDisplay===0?'Not billed':line.name),
    receivePrice:priceDisplay,
    receiveQty:r.received,
    receiveBilledQty:billedDisplay,
    receiveUnit:r.billedUnit&&r.billedUnit!=='Unit unclear'?r.billedUnit:line.unit,
    statusLabel:statusParts.join(' · '),
    statusTone,
    issueTheme,
    priceDiffers,
    codeDiffers,
    nameDiffers,
    qtyDiffers,
    unitCheckRequired,
    unitNote,
    detailMismatch,
    mismatchReasons,
    defaultMark,
    creditEstimatePence,
   });
  }else{
   unmatchedIndex++;
   const readingRow=reading||{page:1,row:unmatchedIndex,name:r.name,unit:r.unit,quantity:r.billedDisplay,price:r.priceDisplay};
   const topSuggestion=r.matchSuggestions?.[0];
   const lineAmountPence=readingRow.quantity!=null&&readingRow.price!=null?Math.round(readingRow.quantity*readingRow.price*100):0;
   const savedExtra=hasConfirmedExtraReview(record,readingRow.page,readingRow.row)
    ?extraReviews.find(v=>v.page===readingRow.page&&v.row===readingRow.row)
    :undefined;
   const defaultMark:SimpleTableMark=savedExtra?.decision==='SUPPLIER_ITEM'?'DONE':'FOLLOW';
   unmatched.push({
    kind:'UNMATCHED',
    id:r.id,
    page:readingRow.page,
    row:readingRow.row,
    receiveNo:`U${unmatchedIndex}`,
    receiveProductId:readingRow.code||'—',
    receiveProductName:readingRow.name,
    receivePrice:readingRow.price,
    receiveQty:readingRow.quantity,
    receiveUnit:readingRow.unit||'unit',
    statusLabel:savedExtra?(savedExtra.decision==='SUPPLIER_ITEM'?'Matched to supplier item':'Unauthorised (leave unmatched)'):'Not on order',
    suggestedName:topSuggestion?.name,
    suggestedLineId:topSuggestion?.lineId,
    ...(savedExtra?{savedDecision:savedExtra.decision,savedProductId:savedExtra.supplierProductId,savedReason:savedExtra.reason}:{}),
    defaultMark,
    lineAmountPence,
   });
  }
 }

 const supplierOptions=catalogProducts
  .filter(p=>p.supplierId===record.supplierId&&p.active!==false)
  .map(p=>({id:p.id,code:p.itemCode||p.id,name:p.name,price:p.casePrice??p.packPrice,unit:p.caseUnitName||p.packUnitName||'case'}));

 const followCount=ordered.filter(r=>r.defaultMark==='FOLLOW').length+unmatched.filter(u=>u.defaultMark==='FOLLOW').length;
 const doneCount=ordered.filter(r=>r.defaultMark==='DONE').length+unmatched.filter(u=>u.defaultMark==='DONE').length;
 const estimatedClaimPence=ordered.reduce((sum,r)=>sum+r.creditEstimatePence,0);

 return {
  ordered,
  unmatched,
  supplierOptions,
  summary:{totalLines:ordered.length,followCount,doneCount,unmatchedCount:unmatched.length,estimatedClaimPence},
 };
}

export function computeTableTotalsCheck(
 ordered:Pick<SimpleOrderedRow,'orderQty'|'orderPrice'|'receiveQty'|'receiveBilledQty'|'receivePrice'>[],
 unmatched:Pick<SimpleUnmatchedRow,'lineAmountPence'>[],
 inputs:{netPence?:number;vatPence?:number;grossPence?:number;adjustmentPence:number},
):TableTotalsCheck {
 let allOrderedBilledKnown=true;
 let orderedLineBilledSumPence=0;
 for(const r of ordered){
  const q=r.receiveBilledQty??r.receiveQty??r.orderQty;
  const p=r.receivePrice??r.orderPrice;
  if(q===0){
   continue;
  }
  if(q==null||p==null){
   allOrderedBilledKnown=false;
   continue;
  }
  orderedLineBilledSumPence+=Math.round(q*p*100);
 }
 const unmatchedExtraSumPence=unmatched.reduce((s,u)=>s+(u.lineAmountPence||0),0);
 const expectedNetWithAdjustmentPence=orderedLineBilledSumPence+inputs.adjustmentPence;
 const netPlusVatMatchesGross=inputs.netPence!=null&&inputs.vatPence!=null&&inputs.grossPence!=null&&inputs.netPence+inputs.vatPence===inputs.grossPence;
 const linesPlusAdjustmentMatchesNet=allOrderedBilledKnown&&inputs.netPence!=null&&expectedNetWithAdjustmentPence===inputs.netPence;
 const differenceToNetPence=inputs.netPence!=null&&allOrderedBilledKnown?inputs.netPence-expectedNetWithAdjustmentPence:undefined;

 return {
  orderedLineBilledSumPence,
  allOrderedBilledKnown,
  unmatchedExtraSumPence,
  expectedNetWithAdjustmentPence,
  netPlusVatMatchesGross,
  linesPlusAdjustmentMatchesNet,
  differenceToNetPence,
 };
}

export interface ClaimSummaryLine {
 lineId:string;
 name:string;
 reason:string;
 netPence:number;
 creditedPence:number;
 replacementPence:number;
 openPence:number;
}

export interface ClaimSummaryMetrics {
 hasConfirmedClaim:boolean;
 originalNetPence:number;
 creditedPence:number;
 replacementPence:number;
 resolvedPence:number;
 openBalancePence:number;
 lineBreakdown:ClaimSummaryLine[];
}

export function computeClaimSummaryMetrics(
 record:Pick<InvoiceCase,'lines'|'claim'>,
 fallbackFollowRows:Pick<SimpleOrderedRow,'lineId'|'orderProductName'|'statusLabel'|'creditEstimatePence'|'mismatchReasons'>[]=[],
):ClaimSummaryMetrics{
 if(record.claim){
  const lineBreakdown:ClaimSummaryLine[]=record.claim.lines.map(cl=>{
   const line=record.lines.find(l=>l.id===cl.lineId);
   const openPence=Math.max(0,cl.netPence-cl.creditedPence-cl.replacementPence);
   return {
    lineId:cl.lineId,
    name:line?.name||cl.lineId,
    reason:cl.reason,
    netPence:cl.netPence,
    creditedPence:cl.creditedPence,
    replacementPence:cl.replacementPence,
    openPence,
   };
  });
  const originalNetPence=lineBreakdown.reduce((s,l)=>s+l.netPence,0);
  const creditedPence=lineBreakdown.reduce((s,l)=>s+l.creditedPence,0);
  const replacementPence=lineBreakdown.reduce((s,l)=>s+l.replacementPence,0);
  const resolvedPence=creditedPence+replacementPence;
  const openBalancePence=lineBreakdown.reduce((s,l)=>s+l.openPence,0);
  return {hasConfirmedClaim:true,originalNetPence,creditedPence,replacementPence,resolvedPence,openBalancePence,lineBreakdown};
 }
 const lineBreakdown:ClaimSummaryLine[]=fallbackFollowRows
  .filter(r=>r.creditEstimatePence>0)
  .map(r=>({
   lineId:r.lineId,
   name:r.orderProductName,
   reason:r.mismatchReasons.join(' · ')||r.statusLabel,
   netPence:r.creditEstimatePence,
   creditedPence:0,
   replacementPence:0,
   openPence:r.creditEstimatePence,
  }));
 const originalNetPence=lineBreakdown.reduce((s,l)=>s+l.netPence,0);
 return {
  hasConfirmedClaim:false,
  originalNetPence,
  creditedPence:0,
  replacementPence:0,
  resolvedPence:0,
  openBalancePence:originalNetPence,
  lineBreakdown,
 };
}

export type ChecklistJumpTarget='TOTALS'|'READING'|'ITEMS'|'EXTRA'|'SIGNOFF'|'CREDITS';

export interface SimpleChecklistStep {
 id:'DETAILS'|'ITEMS'|'FINISH';
 number:1|2|3;
 title:string;
 summary:string;
 done:boolean;
 attention:boolean;
 target:ChecklistJumpTarget;
}

export interface SimpleInvoiceChecklist {
 steps:SimpleChecklistStep[];
 nextHint:string;
 nextTarget:ChecklistJumpTarget;
 readingActionCount:number;
 readingActionLabel:string;
 pendingExtraCount:number;
 remainingCount:number;
}

export function formatShortOrderRef(orderId?:string):string {
 const raw=String(orderId||'').trim();
 if(!raw)return '';
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)){
  return '#'+raw.slice(0,8).toUpperCase();
 }
 return raw.length>18?'#'+raw.slice(0,14)+'…':raw;
}

export function formatInvoiceWorkspaceTitle(record:Pick<InvoiceCase,'invoiceReference'|'supplierName'|'branchName'|'orderIds'|'id'>):{title:string;orderRef:string} {
 const ref=record.invoiceReference?.trim();
 const orderRef=formatShortOrderRef(record.orderIds[0]||record.id);
 if(ref)return {title:ref,orderRef};
 return {title:record.supplierName||'Check invoice',orderRef};
}

export function summarizeInvoiceChecklist(
 record:InvoiceCase,
 approvalProblems:string[],
 options:{
  followOrderedCount:number;
  pendingExtraCount:number;
  totalsBalanced:boolean;
  hasRefAndDate:boolean;
  matchingVerified:boolean;
  totalsVerified:boolean;
  openClaimPence:number;
  hasPendingLaterDelivery:boolean;
  claimableCount:number;
 },
):SimpleInvoiceChecklist {
 const readingProblems=approvalProblems.filter(p=>{
  const lower=p.toLowerCase();
  return lower.includes('reading review')||lower.includes('blank invoice row')||lower.includes('no longer matches its original');
 });
 let readingActionCount=0;
 for(const p of readingProblems){
  const m=p.match(/(\d+)/);
  readingActionCount+=m?Number(m[1]):1;
 }
 const readingActionLabel=readingProblems.length
  ? readingProblems.map(p=>p.replace(/ against the original before approval\.?$/i,'').replace(/ in the reading review\.?$/i,'')).join(' · ')
  : '';

 const detailsDone=options.hasRefAndDate&&options.totalsBalanced;
 const itemsDone=readingProblems.length===0&&options.pendingExtraCount===0&&!approvalProblems.some(p=>{
  const lower=p.toLowerCase();
  return lower.includes('complete receipt')||lower.includes('review and resolve every item');
 });
 const creditsBlocked=options.openClaimPence>0||options.hasPendingLaterDelivery||approvalProblems.some(p=>{
  const lower=p.toLowerCase();
  return lower.includes('claim')||lower.includes('credit')||lower.includes('later delivery');
 });
 const finishDone=record.status==='APPROVED'||(approvalProblems.length===0&&options.matchingVerified&&options.totalsVerified);

 const step1:SimpleChecklistStep={
  id:'DETAILS',
  number:1,
  title:'Invoice details',
  summary:!options.hasRefAndDate?'Enter ref & date':!options.totalsBalanced?'Check Net, VAT & Gross':'Totals matched',
  done:detailsDone,
  attention:!detailsDone,
  target:'TOTALS',
 };

 const step2Summary=readingProblems.length>0
  ? `${readingActionCount} scan check${readingActionCount===1?'':'s'}`
  : options.pendingExtraCount>0
   ? `${options.pendingExtraCount} extra item${options.pendingExtraCount===1?'':'s'}`
   : options.followOrderedCount>0
    ? `${options.followOrderedCount} item${options.followOrderedCount===1?'':'s'} flagged`
    : itemsDone
     ? 'Items checked'
     : 'Review items';

 const step2Target:ChecklistJumpTarget=readingProblems.length>0
  ? 'READING'
  : options.pendingExtraCount>0
   ? 'EXTRA'
   : 'ITEMS';

 const step2:SimpleChecklistStep={
  id:'ITEMS',
  number:2,
  title:'Check items',
  summary:step2Summary,
  done:itemsDone&&options.followOrderedCount===0,
  attention:!itemsDone||options.pendingExtraCount>0,
  target:step2Target,
 };

 const step3Summary=record.status==='APPROVED'
  ? 'Approved'
  : creditsBlocked
   ? (options.hasPendingLaterDelivery?'Review replacement':options.openClaimPence>0?'Credit outstanding':'Send supplier claim')
   : (!options.matchingVerified||!options.totalsVerified)
    ? 'Tick 2 sign-off boxes'
    : options.claimableCount>0&&!record.claim
     ? 'Prepare claim or approve'
     : approvalProblems.length===0
      ? 'Ready to approve'
      : 'Save & approve';

 const step3Target:ChecklistJumpTarget=creditsBlocked?'CREDITS':'SIGNOFF';

 const step3:SimpleChecklistStep={
  id:'FINISH',
  number:3,
  title:'Confirm & finish',
  summary:step3Summary,
  done:finishDone,
  attention:!finishDone&&(detailsDone&&itemsDone),
  target:step3Target,
 };

 let nextHint='All checks complete — ready to approve this invoice.';
 let nextTarget:ChecklistJumpTarget='SIGNOFF';
 if(record.status==='APPROVED'){
  nextHint='Invoice approved and locked.';
 }else if(readingProblems.length>0){
  nextHint=`Next: ${readingActionLabel}.`;
  nextTarget='READING';
 }else if(!options.hasRefAndDate){
  nextHint='Next: Enter the invoice number and date (or click Fill from AI draft).';
  nextTarget='TOTALS';
 }else if(options.pendingExtraCount>0){
  nextHint=`Next: Match or mark ${options.pendingExtraCount} extra item${options.pendingExtraCount===1?'':'s'} not on the order.`;
  nextTarget='EXTRA';
 }else if(!options.totalsBalanced){
  nextHint='Next: Check Net, VAT, charges and Gross so the invoice totals match.';
  nextTarget='TOTALS';
 }else if(creditsBlocked){
  nextHint=options.hasPendingLaterDelivery
   ?'Next: Review the later replacement delivery in Credits & Replacements.'
   :options.openClaimPence>0
    ?'Next: Record the supplier credit note or replacement in Credits & Replacements.'
    :'Next: Send the supplier claim in Credits & Replacements.';
  nextTarget='CREDITS';
 }else if(!itemsDone){
  nextHint='Next: Check highlighted items and click Save review.';
  nextTarget='ITEMS';
 }else if(!options.matchingVerified||!options.totalsVerified){
  nextHint='Next: Tick the 2 confirmation boxes below, then save or approve.';
  nextTarget='SIGNOFF';
 }else if(approvalProblems.length>0){
  nextHint=`Next: ${approvalProblems[0]}`;
  nextTarget='SIGNOFF';
 }

 return {
  steps:[step1,step2,step3],
  nextHint,
  nextTarget,
  readingActionCount,
  readingActionLabel,
  pendingExtraCount:options.pendingExtraCount,
  remainingCount:approvalProblems.length,
 };
}


