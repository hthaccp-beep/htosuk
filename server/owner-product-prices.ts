/** Apply reviewed owner prices immediately, with an immutable audit history. */
export function applyOwnerProductPrices(user:any,body:any,products:any[],plan:{updates:any[];notices:any[]}){
 const history:any[]=[];
 if(user.role!=='CREATOR')return history;
 for(const notice of plan.notices){
  const old=products.find(p=>p.id===notice.productId);
  let update=plan.updates.find(u=>u.id===old.id);
  if(!update){update={id:old.id,changes:{},before:{}};plan.updates.push(update);}
  const record:any={id:`ph_${notice.id}`,productId:old.id,productName:notice.productName,itemCode:notice.itemCode,supplierId:old.supplierId,supplierName:body.supplierName||old.supplierId,effectiveDate:notice.effectiveDate,detectedDate:notice.detectedDate,approvedAt:notice.detectedDate,approvedByUserId:user.id,approvedByUserName:user.displayName||user.id,status:'ACTIVE',source:'OWNER_BULK_EDIT',changeType:'PRICE_UPDATE',reason:'Owner confirmed bulk product changes'};
  for(const [field,previous,next] of [['casePrice','previousCasePrice','newCasePrice'],['packPrice','previousPackPrice','newPackPrice']]){
   if(old[field]!==undefined)record[previous]=old[field];
   if(notice[next]!==undefined){record[next]=notice[next];if(notice[next]!==old[field]){update.changes[field]=notice[next];update.before[field]=old[field]??null;}}
  }
  history.push(record);
 }
 plan.notices=[];
 return history;
}
