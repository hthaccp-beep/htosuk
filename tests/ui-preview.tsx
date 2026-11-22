import {PriceDeletePreview} from './price-delete-preview';
import {catalogueReviewDetails} from '../shared/catalogue-review';
import {productFingerprint} from '../shared/product-workbench';
import {SupplierProductsSource} from '../hooks/useSupplierProducts';
import {deliveryReviewLines} from '../shared/document-review';
import {createInvoicePreviewService} from './invoice-preview-handler';
import {SimpleInvoiceTableDraft} from './SimpleInvoiceTableDraft';
import {CheckWorkflowContext} from '../app/htos/CheckWorkflow';
import {calculateOrderReconciliation} from '../utils/invoiceReconciliation';
import {reportDatabaseError} from '../hooks/databaseStatus';
// Standalone synthetic UI harness. Excluded from production Vercel uploads and entry point.
import React from 'react';
import {SupplierReviewPreview} from './supplier-review-preview';
import {ProductWorkbench} from '../app/htos/ProductWorkbench';
import {CatalogImportContext,SupplierFileReaderContext,ProductTransfer} from '../app/htos/ProductTransfer';
import {readSupplierFile} from '../app/htos/documentFiles';
import {priceWarnings} from '../shared/supplier-file';
import {parseSupplierCatalogCSV,planSupplierCatalogImport} from '../utils/supplierCatalogImport';
import {resolveCatalogueConflicts} from '../shared/catalogue-conflicts';
import {prepareCatalogueReplacement} from '../shared/catalogue-replacement';
import {OrderSendContext} from '../app/htos/OrderSendWorkflow';
import {sendAndRecordOrderEmail} from '../app/htos/communicationState';
import { createRoot } from 'react-dom/client';
import {HtosRouter as HashRouter} from '../app/htos/HtosRouter';
import { useAppStore } from '../store';
import { auth } from '../firebase-config';
import {SEED_ROLES,DEFAULT_ROLE_PERMISSIONS} from '../constants';
import { Workspace, Login } from '../app/htos/HtosApp';
import '../app/htos/htos.css';
const previewStore=useAppStore;
// Start a fresh synthetic session, even after an earlier preview has timed out.
localStorage.setItem('htos_last_active',String(Date.now()));
const invoicePreview=createInvoicePreviewService({getOrders:()=>previewStore.getState().orders,isStaff:()=>previewStore.getState().currentUser?.id==='sample-staff',roles:DEFAULT_ROLE_PERMISSIONS});
const isStaffPreview=new URLSearchParams(window.location.search).get('role')==='staff';
const user=isStaffPreview?{id:'sample-staff',username:'staff@example.invalid',displayName:'Sample staff',role:'STAFF',branchIds:['sample-putney','qa-b'],supplierIds:['sample-foods','qa-s'],permissionMode:'CUSTOM' as const,customPermissions:['scan_invoices' as const,'place_orders' as const,'view_order_history' as const],active:true}:{id:'qa-owner',username:'qa@example.invalid',displayName:'Preview owner',role:'CREATOR',branchIds:['qa-b','sample-putney'],allBranches:true,allSuppliers:true,active:true};
if(auth&&!auth.currentUser){try{Object.defineProperty(auth,'currentUser',{configurable:true,get:()=>({uid:user.id,email:user.username,getIdToken:async()=>'synthetic-preview-token'})});}catch{}}
const branch={id:'qa-b',name:'Sample branch',code:'QA',active:true,actsAsSupplier:true};
const samplePutneyBranch={id:'sample-putney',name:'Putney (sample)',code:'PUT',active:true,actsAsSupplier:false};
const supplier={id:'qa-s',name:'Sample supplier',minimumOrderAmount:100,branchMinimumOrderAmounts:{'qa-b':50},linkedBranchId:'qa-b',email:'supplier@example.invalid',deliveryRules:{},deliverySchedules:{},allBranches:true,availableBranchIds:[],active:true};
const sampleFoodsSupplier={id:'sample-foods',name:'Example Foods (sample)',minimumOrderAmount:100,branchMinimumOrderAmounts:{},email:'supplier@example.invalid',deliveryRules:{},deliverySchedules:{},allBranches:true,availableBranchIds:[],active:true};
const product={id:'qa-p',name:'Sample rice',itemCode:'QA001',supplierId:'qa-s',categoryId:'qa-c',casePrice:18,packPrice:3,active:true,allowedBranchIds:[],displayOrder:1};
const sampleOrder={branchId:branch.id,branchNameSnapshot:branch.name,supplierId:supplier.id,supplierNameSnapshot:supplier.name,orderedByUserId:user.id,orderedByNameSnapshot:user.displayName,createdAt:new Date().toISOString(),deliveryDate:'2026-10-14',status:'CANCELLED' as const,emailTo:'',items:[],manualItems:[]};
previewStore.setState({currentUser:user,users:[user],roles:SEED_ROLES,rolePermissions:DEFAULT_ROLE_PERMISSIONS,branches:[branch,samplePutneyBranch],suppliers:[supplier,sampleFoodsSupplier],categories:[{id:'qa-c',name:'Dry goods',supplierId:'qa-s',active:true,displayOrder:1},{id:'sf-c',name:'Example Foods Catalogue',supplierId:'sample-foods',active:true,displayOrder:2}],products:[...Array.from({length:24},(_,i)=>({...product,id:i?'qa-p'+(i+1):product.id,active:i!==23,name:i===23?'Inactive test product':['Sample rice','Fresh Shanghai noodles – family pack','Soy sauce'][i%3],chineseName:['大米','上海面条','酱油'][i%3],itemCode:'QA'+String(i+1).padStart(3,'0'),displayOrder:i+1})),{...product,id:'sf-rice',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'R001',name:'Sample rice',casePrice:18,caseUnitName:'bags',displayOrder:1},{...product,id:'sf-noodles',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'N002',name:'Sample noodles',casePrice:20,caseUnitName:'cases',displayOrder:2},{...product,id:'sf-soy',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'S003',name:'Sample soy sauce',casePrice:12,caseUnitName:'cases',displayOrder:3},{...product,id:'sf-mayo',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'M004',name:'Sample mayonnaise',casePrice:3.75,caseUnitName:'packs',displayOrder:4},{...product,id:'sf-ginger',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'G005',name:'Sample ginger',casePrice:5,caseUnitName:'bags',displayOrder:5},{...product,id:'sf-truffle',supplierId:'sample-foods',categoryId:'sf-c',itemCode:'T006',name:'Sample truffle oil',casePrice:24,caseUnitName:'bottles',displayOrder:6}],orders:[{...sampleOrder,id:'qa-draft',status:'DRAFT',items:[{productId:product.id,productNameSnapshot:product.name,caseQty:2,packQty:0,casePriceSnapshot:18,packPriceSnapshot:3}]},{...sampleOrder,id:'qa-review',status:'PLACED',items:[{productId:product.id,productNameSnapshot:product.name,itemCodeSnapshot:product.itemCode,caseQty:10,packQty:0,casePriceSnapshot:18,packPriceSnapshot:3}]},...invoicePreview.previewOrders,{...sampleOrder,id:'qa-cancelled'},{...sampleOrder,id:'qa-archived',archived:true}],
  addOrder:async order=>{previewStore.setState(s=>({orders:[order,...s.orders]}));},
  updateOrder:async(id,updates)=>{previewStore.setState(s=>({orders:s.orders.map(o=>o.id===id?{...o,...updates}:o)}));},
  markOrderAsProcessed:async(id,updates)=>{previewStore.setState(s=>({orders:s.orders.map(o=>o.id===id?{...o,...updates,receivedStatus:'PROCESSED'}:o)}));},
  deleteOrder:async id=>{previewStore.setState(s=>({orders:s.orders.filter(o=>o.id!==id)}));},
  fetchArchivedOrders:async()=>{},
});
// Larger synthetic catalogue exercises spreadsheet pagination and hidden edits.
if(new URLSearchParams(window.location.search).has('bulkGrid'))previewStore.setState(state=>({products:Array.from({length:36},(_,i)=>({...state.products[i%24],id:'qa-grid-'+i,itemCode:'GRID'+String(i+1).padStart(3,'0'),name:i===35?'Inactive sample product':'Sample product '+(i+1),active:i!==35,displayOrder:i+1,packSize:'6 × 1 kg',vatRate:.2,unitType:'DUAL' as const,caseUnitName:'Case',packUnitName:'Unit'}))}));
// Every preview save stays in memory; no production database is configured.
if(new URLSearchParams(window.location.search).has('catalogConflicts'))previewStore.setState(state=>({products:[...state.products,{...product,id:'qa-conflict',name:'Alternative rice – check the pack',packSize:'10kg',casePrice:22,packPrice:4,active:false}]}));
if(new URLSearchParams(window.location.search).get('ordering')==='1') previewStore.setState(state=>({
 branches:[...state.branches,{...branch,id:'qa-b2',name:'Second sample branch',code:'QA2'}],
 suppliers:[...state.suppliers,{...supplier,id:'qa-s2',name:'Second sample supplier',linkedBranchId:undefined}],
 products:[...state.products.map(p=>p.id==='qa-p2'?{...p,allowedBranchIds:['qa-b']}:p),{...product,id:'qa-other',name:'Other supplier item',supplierId:'qa-s2',categoryId:''}],
 orders:state.orders.map(o=>o.id==='qa-draft'?{...o,comments:'Saved draft delivery note'}:o),
}));
for(const [singular,plural] of [['Branch','branches'],['Supplier','suppliers'],['Category','categories'],['Product','products'],['Role','roles']] as const){
 previewStore.setState({
  ['add'+singular]:async(value:any)=>previewStore.setState((state:any)=>({[plural]:[...state[plural],value]})),
  ['update'+singular]:async(value:any)=>previewStore.setState((state:any)=>({[plural]:state[plural].map((r:any)=>r.id===value.id?value:r)})),
  ['delete'+singular]:async(id:string)=>previewStore.setState((state:any)=>({[plural]:state[plural].filter((r:any)=>r.id!==id)}))
 } as any);
}
previewStore.setState({savePriceMonitoringSettings:async value=>previewStore.setState({priceMonitoringSettings:value}),updateRolePermissions:async(id,permissions)=>previewStore.setState(s=>({rolePermissions:{...s.rolePermissions,[id]:permissions}}))});
if(new URLSearchParams(window.location.search).get('orders')==='1') previewStore.setState(state=>({orders:[...state.orders,...Array.from({length:14},(_,i)=>({...sampleOrder,id:`qa-list-${String(i+1).padStart(8,'0')}`,status:'PLACED' as const,createdAt:new Date(Date.now()-(i+1)*3600000).toISOString(),emailStatus:i%3===0?'FAILED' as const:'SENT' as const,...(i%3===0?{emailError:'SMTP 550 mailbox unavailable in synthetic test',emailRetryCount:1}:{}),...(i%4===1?{minimumOrderCheck:{subtotal:36,minimum:50,shortfall:14,unpricedItems:0,needsFollowUp:true}}:{}),receivedStatus:i%2===0?'PROCESSED' as const:undefined,fulfillmentStatus:i%4===0?'PARTIAL' as const:'FULFILLED' as const,deliveryEmailStatus:i%4===0?'FAILED' as const:'SENT' as const,items:[{productId:product.id,productNameSnapshot:product.name,caseQty:2,packQty:0,casePriceSnapshot:18,packPriceSnapshot:3}]}))]}));
if(new URLSearchParams(window.location.search).get('quota')==='1') reportDatabaseError({code:'resource-exhausted'});
if(new URLSearchParams(window.location.search).get('dispatch')==='1') previewStore.setState(s=>({orders:s.orders.map(o=>o.id==='qa-review'?{...o,manualItems:[{id:'qa-manual',description:'Special packaging',caseQty:0,packQty:3,packUnitSnapshot:'Pack'}]}:o)}));
if(new URLSearchParams(window.location.search).get('access')==='unassigned') previewStore.setState(s=>({currentUser:{...s.currentUser!,branchIds:[]}}));
if(new URLSearchParams(window.location.search).get('access')==='gm') previewStore.setState(s=>({currentUser:{...s.currentUser!,role:'GM',branchIds:[]}}));
const checkRequest=async(body:any)=>{
 if(typeof body?.action==='string'&&body.action.startsWith('invoice-case-')){
  const result=await invoicePreview.handle(body);
  if(result!==null)return result;
 }
 const current=previewStore.getState().orders.find(o=>o.id===body.orderId)!;const update=async(value:any)=>previewStore.getState().updateOrder(current.id,value);
 if(body.action==='delivery-check'){if(!body.draft&&body.lines.some((l:any)=>l.receivedCases==null||l.receivedUnits==null||!l.checked))throw new Error('Confirm actual received quantities and check each item.');await update({deliveryCheck:{...body,version:(current.deliveryCheck?.version||0)+1,checkedBy:'Preview owner',checkedAt:new Date().toISOString()}});return {success:true};}
 if(body.action==='invoice-review'){const result=calculateOrderReconciliation(current,body.lines,{comparisonOnly:true,isDraft:body.draft,invoiceNumber:body.invoiceNumber,invoiceDate:body.invoiceDate,verifierName:'Preview owner',remarks:body.notes});if(!body.draft&&!result.canFinalize)throw new Error(result.blockingReasons.join(' '));await update({...result.sanitizedUpdates,invoiceVerification:{...result.sanitizedUpdates.invoiceVerification,evidence:body.evidence,version:1,lines:result.sanitizedUpdates.invoiceVerification?.lines?.map((l:any,i:number)=>({...l,...body.lines[i],inputVersion:2,enteredLineTotal:body.lines[i].invoicedLineTotal}))},...(body.combined?{deliveryCheck:{version:(current.deliveryCheck?.version||0)+1,reference:body.invoiceNumber,date:body.invoiceDate,partial:body.partial,draft:body.draft,lines:deliveryReviewLines(body.lines),evidence:body.evidence,notes:body.notes}}:{})});return {success:true};}
 const route={from:'branch@example.invalid',fromName:'Sample branch',to:['supplier@example.invalid'],cc:['branch@example.invalid','office@example.invalid','accounts@example.invalid'],accounts:['accounts@example.invalid'],source:body.source,subject:'TEST PREVIEW · Supplier request',message:'Synthetic discrepancy report. No email will be sent.',evidenceCount:current.deliveryCheck?.evidence.length||0,previewKey:'synthetic',ready:true};
 if(body.action==='case-preview')return route;
 if(body.action==='case-send'){await update({supplierCase:{...route,id:'qa-case',version:1,sourceVersion:1,requestedAmount:body.source==='INVOICE'?current.creditNoteClaim?.totalClaimAmount||0:0,emailState:'SENT',accepted:[...route.to,...route.cc],rejected:[],createdAt:new Date().toISOString(),credits:[]}});return {success:true};}
 if(body.action==='case-credit'){if(!body.reference||!(body.amount>0))throw new Error('Enter reference and a positive net amount.');await update({supplierCase:{...current.supplierCase,version:current.supplierCase!.version+1,credits:[...current.supplierCase!.credits,{id:'qa-credit',reference:body.reference,date:body.date,amount:body.amount,notes:body.notes,document:body.document,recordedBy:'Preview owner'}]}});return {success:true};}
 if(body.action==='case-resolve'){await update({supplierCase:{...current.supplierCase,version:current.supplierCase!.version+1,resolvedAt:new Date().toISOString(),resolution:body.resolution}});return {success:true};}
 throw new Error('This operation is not enabled in the isolated preview.');
};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.pathname:input.url;
 if(url==='/api/admin/workspace'&&init?.body&&typeof init.body==='string'){
  try{
   const parsed=JSON.parse(init.body);
   if(typeof parsed?.action==='string'&&parsed.action.startsWith('invoice-case-')){
    const data=await invoicePreview.handle(parsed);
    if(data!==null)return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
   }
  }catch(e:any){
   return new Response(JSON.stringify({error:e?.message||'Preview error'}),{status:e?.status||400,headers:{'Content-Type':'application/json'}});
  }
 }
 return originalFetch(input,init);
};

const fileCalls:any[]=[];
(window as any).__htosFilePreview={calls:fileCalls,snapshot:()=>structuredClone({products:previewStore.getState().products,orders:previewStore.getState().orders})};
let failedOnce=false;
const catalogRequest=async(body:any)=>{
 if(new URLSearchParams(window.location.search).has('bulkGrid'))(window as any).__htosBulkRequests=((window as any).__htosBulkRequests||[]).concat(structuredClone(body));
 fileCalls.push({action:body.action,requestId:body.requestId,csv:body.csv,mode:body.mode,removeMissing:body.removeMissing});
 const testSave=new URLSearchParams(window.location.search).get('save');
 if(body.action==='catalog-commit'&&testSave==='failed-once'&&!failedOnce){failedOnce=true;throw new Error('Synthetic one-off failure. Retry the same review.');}
 if(body.action==='catalog-preview'&&testSave==='changed'&&body.mode==='supplier-file')previewStore.setState(state=>({products:state.products.map(p=>p.id==='qa-p'?{...p,casePrice:99}:p)}));
 const state=previewStore.getState();let n=0;
 if(body.action==='catalog-commit'&&new URLSearchParams(window.location.search).get('save')==='failed')throw new Error('Synthetic import failure. Nothing saved; review kept for retry.');
 if(body.action==='product-bulk'){
  if(new URLSearchParams(window.location.search).get('save')==='slow')await new Promise(resolve=>setTimeout(resolve,600));
  if(new URLSearchParams(window.location.search).get('save')==='failed')throw new Error('Synthetic save failure. Your edits are kept for retry.');
  previewStore.setState({products:state.products.map(p=>{const row=body.rows.find((r:any)=>r.id===p.id);return row?{...p,...row.values,...(body.sequence?{cataloguePosition:body.sequence.indexOf(p.id)+1,displayOrder:body.sequence.indexOf(p.id)+1}:{})}:p;})});return {updated:body.rows.length,proposed:0,immediatePrices:true};
 }
 const replacement=body.mode==='replace-catalogue';
 const input=parseSupplierCatalogCSV(body.csv);
 const sourceProducts=replacement?prepareCatalogueReplacement(input,body.supplierId,state.products).products:state.products;
 const resolution=replacement?{rows:input,unresolved:[],conflicts:[],reviewedIds:undefined,protectedIds:new Set<string>(),selections:[]}:resolveCatalogueConflicts(input,body.supplierId,state.products,body.conflictChoices);
 if(resolution.unresolved.length)return {status:'conflicts',expected:'synthetic',conflicts:resolution.conflicts};
 const plan=planSupplierCatalogImport({rows:resolution.rows,supplierId:body.supplierId,products:sourceProducts,categories:state.categories,branches:state.branches,reviewedConflictIds:resolution.reviewedIds,allowUncodedCreates:replacement,newId:()=>`qa-import-${++n}`});
 const ids=new Set(resolution.rows.map(r=>r.SystemID||(!replacement?state.products.find(p=>p.itemCode===r.ItemCode)?.id:undefined)));
 const missing=state.products.filter(p=>p.supplierId===body.supplierId&&p.active&&!ids.has(p.id)&&!resolution.protectedIds.has(p.id));
 const changedPrices=plan.updates.filter(u=>u.changes.casePrice!==undefined||u.changes.packPrice!==undefined).map(u=>{const p=state.products.find(p=>p.id===u.id)!;return {name:p.name,itemCode:p.itemCode,before:{casePrice:p.casePrice??null,packPrice:p.packPrice??null},after:{casePrice:u.changes.casePrice??p.casePrice??null,packPrice:u.changes.packPrice??p.packPrice??null},flags:priceWarnings(p,u.changes)};});
 const prices=[...changedPrices,...plan.creates.filter(p=>p.casePrice!==undefined||p.packPrice!==undefined).map(p=>({name:p.name,itemCode:p.itemCode,before:{casePrice:null,packPrice:null},after:{casePrice:p.casePrice??null,packPrice:p.packPrice??null},flags:priceWarnings({},p)}))];
 const matchedItems=plan.updates.map(u=>{const p=state.products.find(p=>p.id===u.id)!;return {id:p.id,fingerprint:productFingerprint(p),itemCode:p.itemCode,before:{name:p.name,casePrice:p.casePrice??null,packPrice:p.packPrice??null},after:{name:u.changes.name??p.name,casePrice:u.changes.casePrice??p.casePrice??null,packPrice:u.changes.packPrice??p.packPrice??null},flags:priceWarnings(p,u.changes)};});
 const result={expected:'synthetic',matchedItems,prices,added:plan.creates.length,updated:plan.updates.length,immediatePrices:true,proposed:0,pricesApplied:changedPrices.length,unchanged:plan.unchanged,missing,removed:body.removeMissing?missing.length:0,details:catalogueReviewDetails(plan,state.products)};
 if(body.action==='catalog-commit'){previewStore.setState({categories:[...state.categories,...plan.categories],products:[...state.products.map(p=>({...p,...plan.updates.find(u=>u.id===p.id)?.changes,...(body.removeMissing&&missing.some(m=>m.id===p.id)?{active:false}:{})})),...plan.creates]});}
 return {...result,selections:resolution.selections};
};
const readPreviewFile:typeof readSupplierFile=async file=>{
 if(/\.(csv|xlsx|xls)$/i.test(file.name))return readSupplierFile(file);
 if(!/\.(pdf|png|jpg|jpeg|webp)$/i.test(file.name))throw new Error('Unsupported test file.');
 if(file.name.includes('failed'))throw new Error('Synthetic scanner unavailable. No prices changed.');
 return {scanned:true,supplierName:'Sample supplier',invoiceNumber:'TEST-001',invoiceDate:'2026-10-17',currency:'GBP',notes:'Synthetic scan: check the original document.',rows:[{itemCode:'QA001',rawDescription:'Sample rice',packSize:'',casePrice:27,packPrice:null,unitPrice:27,unitTypeDetected:'CASE',notes:'Check printed price'},{itemCode:'UNKNOWN',rawDescription:'Unknown item',unitPrice:12,unitTypeDetected:'KG'}]};
};
const previewProducts:React.ContextType<typeof SupplierProductsSource>=(_scope,id,next,_error,fullIntegrity)=>{next({products:previewStore.getState().products.filter(p=>fullIntegrity||p.supplierId===id),fromCache:false});return()=>{};};
const ownerUser={id:'qa-owner',username:'qa@example.invalid',displayName:'Preview owner',role:'CREATOR',branchIds:['qa-b','sample-putney'],allBranches:true,allSuppliers:true,active:true};
const staffUser={id:'sample-staff',username:'staff@example.invalid',displayName:'Sample staff',role:'STAFF',branchIds:['sample-putney','qa-b'],supplierIds:['sample-foods','qa-s'],permissionMode:'CUSTOM' as const,customPermissions:['scan_invoices' as const,'place_orders' as const,'view_order_history' as const],active:true};
const initialDraftFlag=(window as any).__HTOS_PREVIEW_DEFAULT==='table'||new URLSearchParams(window.location.search).get('draft')==='table'||window.location.hash==='#/draft-table'||window.location.pathname==='/draft-table'||window.location.pathname==='/sample-check';

function PreviewRoot(){
 const [tableDraft,setTableDraft]=React.useState(initialDraftFlag);
 const [isStaff,setIsStaff]=React.useState(isStaffPreview);
 const openChecks=(staff=false)=>{
  setIsStaff(staff);
  previewStore.setState({currentUser:staff?staffUser:ownerUser,users:[staff?staffUser:ownerUser]});
  setTableDraft(false);
  window.location.hash='#/checks';
 };
 const openReports=()=>{
  setIsStaff(false);
  previewStore.setState({currentUser:ownerUser,users:[ownerUser]});
  setTableDraft(false);
  window.location.hash='#/reports';
 };
 const openTable=()=>{
  setIsStaff(false);
  previewStore.setState({currentUser:ownerUser,users:[ownerUser]});
  setTableDraft(true);
 };
 const search=new URLSearchParams(window.location.search);
 const workspaceNode=<HashRouter><Workspace/></HashRouter>;
 const content=search.has('priceDelete')
  ?<HashRouter><PriceDeletePreview/></HashRouter>
  :tableDraft
   ?<SimpleInvoiceTableDraft request={checkRequest} products={previewStore.getState().products} onOpenClassic={()=>openChecks(false)} onOpenWeeklyReport={openReports}/>
   :search.get('bulkGrid')==='isolated'
    ?<HashRouter><div className="h-app" style={{padding:12}}><ProductWorkbench onIndividual={()=>{}}/></div></HashRouter>
    :search.get('catalogConflicts')==='isolated'
     ?<HashRouter><div style={{padding:24}}><h1>CSV conflict test</h1><ProductTransfer supplierId="qa-s" onSaved={()=>{}}/></div></HashRouter>
     :search.has('supplierReview')
      ?<HashRouter><SupplierReviewPreview/></HashRouter>
      :search.get('login')==='1'
       ?<HashRouter><Login notice=""/></HashRouter>
       :workspaceNode;

 return <SupplierProductsSource.Provider value={previewProducts}><CatalogImportContext.Provider value={catalogRequest}><SupplierFileReaderContext.Provider value={readPreviewFile}><div style={{background:'#e6b56b',padding:'6px 12px',fontSize:11,position:'fixed',top:0,right:0,zIndex:20,display:'flex',flexWrap:'wrap',alignItems:'center',gap:8}}><span>TEST PREVIEW · Synthetic</span><button type="button" onClick={()=>tableDraft?openChecks(false):openTable()} style={{background:'#1d3b1b',color:'#fff',border:'none',borderRadius:4,padding:'3px 8px',fontSize:11,fontWeight:600,cursor:'pointer'}}>{tableDraft?'Current 9.20 view':'Try simple table draft'}</button><button type="button" onClick={()=>openChecks(!isStaff)} style={{background:'#fff',color:'#1d3b1b',border:'1px solid #1d3b1b',borderRadius:4,padding:'3px 8px',fontSize:11,fontWeight:600,cursor:'pointer'}}>{isStaff?'Accounts view':'Staff upload'}</button></div><OrderSendContext.Provider value={{preview:async()=>({fromName:'Sample branch',from:'branch@example.invalid',to:['supplier@example.invalid'],cc:['branch@example.invalid','office@example.invalid'],replyTo:'branch@example.invalid',routeKey:'synthetic',ready:true}),send:async(order,route,branch,supplier,products,save)=>{await sendAndRecordOrderEmail(order,async()=>new Response(JSON.stringify({error:'Synthetic email failure; no message was sent.'}),{status:search.get('email')==='failed'?503:200}),save);}}}><CheckWorkflowContext.Provider value={checkRequest}>{content}</CheckWorkflowContext.Provider></OrderSendContext.Provider></SupplierFileReaderContext.Provider></CatalogImportContext.Provider></SupplierProductsSource.Provider>;
}

createRoot(document.getElementById('root')!).render(<PreviewRoot/>);
