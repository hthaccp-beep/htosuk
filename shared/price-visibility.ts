// Explicit projections: new financial fields stay private until deliberately reviewed.
const productFields='id itemCode name chineseName categoryId supplierId displayOrder cataloguePosition allowedBranchIds active packSize unitType caseUnitName packUnitName minParLevel targetParLevel removedAt version'.split(' ');
const orderFields='id branchId branchNameSnapshot supplierId supplierNameSnapshot orderedByUserId orderedByNameSnapshot departmentId departmentNameSnapshot createdAt deliveryDate comments emailTo status archived archivedAt archivedByUserId emailStatus whatsAppStatus emailSentAt emailError emailRetryCount receivedStatus fulfillmentStatus processedAt processedByUserId processedByNameSnapshot fulfillmentNotes deliveryEmailStatus deliveryEmailSentAt deliveryEmailError deliveryEmailRetryCount deliveryCheck _entryRevision'.split(' ');
const itemFields='id productId description productNameSnapshot chineseNameSnapshot itemCodeSnapshot caseQty packQty caseUnitSnapshot packUnitSnapshot sentCaseQty sentPackQty shortageReason'.split(' ');
function pick(value:any, fields:string[]) {return Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));}
export function productWithoutPrices(value:any) {return pick(value,productFields);}
export function orderWithoutPrices(value:any):Record<string,any> {
  return {...pick(value,orderFields),items:(value.items||[]).map((item:any)=>pick(item,itemFields)),manualItems:(value.manualItems||[]).map((item:any)=>pick(item,itemFields)),
    ...(value.minimumOrderCheck ? {minimumOrderCheck:pick(value.minimumOrderCheck,['needsFollowUp','unpricedItems'])} : {})};
}
