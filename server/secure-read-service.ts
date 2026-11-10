import {checkUserActionPermission,OrderAuthorizationError} from './order-authorization.ts';
import {assignedBranches,assignedSuppliers,hasBranchScope,hasSupplierScope,hasIncomingBranchScope} from '../shared/order-scope.ts';
import {productWithoutPrices,orderWithoutPrices} from '../shared/price-visibility.ts';

const validId=(value:any)=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value);
const deny=()=>{throw new OrderAuthorizationError(403,'These records are outside your access.');};
export async function secureRead(db:any,uid:string,body:any) {
  if(!['products','orders'].includes(body.resource))throw new OrderAuthorizationError(400,'Choose a valid record type.');
  for(const key of ['supplierId','branchId','id'])if(body[key]!==undefined&&!validId(body[key]))throw new OrderAuthorizationError(400,'Invalid record reference.');
  for(const key of ['start','end'])if(body[key]!==undefined&&(typeof body[key]!=='string'||!Number.isFinite(Date.parse(body[key]))))throw new OrderAuthorizationError(400,'Invalid date range.');
  const [profile,roleDoc]=await Promise.all([db.collection('users').doc(uid).get(),db.collection('settings').doc('role_permissions').get()]);
  const user={...profile.data(),id:uid},roles=roleDoc.data()?.map;
  if(user.active!==true)deny();
  const prices=checkUserActionPermission(user,'view_prices',roles);
  const incoming=async(supplierId:string)=>{
    if(!checkUserActionPermission(user,'view_received_orders',roles))return false;
    const supplier=(await db.collection('suppliers').doc(supplierId).get()).data();
    const branchId=supplier?.linkedBranchId||(!supplier?supplierId:'');
    if(!branchId||!hasIncomingBranchScope(user,branchId))return false;
    const branch=(await db.collection('branches').doc(branchId).get()).data();
    return branch?.active===true&&branch.actsAsSupplier===true;
  };
  const outgoing=(branchId?:string,supplierId?:string)=>(branchId?hasBranchScope(user,branchId):assignedBranches(user)===null)&&(supplierId?hasSupplierScope(user,supplierId):assignedSuppliers(user)===null);
  if(body.resource==='products') {
    if(body.supplierId?!hasSupplierScope(user,body.supplierId):assignedSuppliers(user)!==null)deny();
  } else if(body.id) {
    const record=await db.collection('orders').doc(body.id).get();
    if(!record.exists) return {records:[],cursor:null};
    const order={...record.data(),id:record.id};
    if(!outgoing(order.branchId,order.supplierId)&&!await incoming(order.supplierId))deny();
    return {records:[prices?order:orderWithoutPrices(order)],cursor:null};
  } else if(body.incomingOnly ? (!body.supplierId||!await incoming(body.supplierId)) : (!outgoing(body.branchId,body.supplierId)&&(!body.supplierId||!await incoming(body.supplierId))))deny();
  const dated=body.resource==='orders'&&!!(body.start||body.end);
  let query=db.collection(body.resource);
  if(dated)query=query.orderBy('createdAt');
  query=query.orderBy('__name__').limit(body.existsOnly?1:500);
  if(body.supplierId)query=query.where('supplierId','==',body.supplierId);
  if(body.resource==='orders') {
    if(body.branchId)query=query.where('branchId','==',body.branchId);
    if(body.start)query=query.where('createdAt','>=',body.start);
    if(body.end)query=query.where('createdAt','<=',body.end);
    if(body.openOnly)query=query.where('receivedStatus','==','NEW');
  }
  if(body.cursor){
    let cursor:any;try{if(typeof body.cursor!=='string'||body.cursor.length>1024)throw Error();cursor=JSON.parse(Buffer.from(body.cursor,'base64url').toString('utf8'));}catch{throw new OrderAuthorizationError(400,'Invalid page reference.');}
    if(!Array.isArray(cursor)||cursor.length!==(dated?2:1)||!validId(cursor.at(-1))||(dated&&(typeof cursor[0]!=='string'||!Number.isFinite(Date.parse(cursor[0])))))throw new OrderAuthorizationError(400,'Invalid page reference.');
    query=query.startAfter(...cursor);
  }
  const page=await query.get();
  return {records:page.docs.map((doc:any)=>{const value={...doc.data(),id:doc.id};return prices?value:body.resource==='products'?productWithoutPrices(value):orderWithoutPrices(value);}),cursor:!body.existsOnly&&page.size===500?Buffer.from(JSON.stringify(dated?[page.docs.at(-1).data().createdAt,page.docs.at(-1).id]:[page.docs.at(-1).id])).toString('base64url'):null};
}
