import test from 'node:test';
import assert from 'node:assert/strict';
import {menuAction} from '../server/menu-service.ts';
import {validateRecipe,validateSpecification} from '../server/menu-validation.ts';
import {recipeGaps} from '../shared/menu-recipes.ts';

function fixture() {
  const data=new Map<string,any>(Object.entries({
    'users/owner':{role:'CREATOR',active:true,displayName:'Test owner'},
    'users/editor':{role:'STAFF',active:true,allBranches:true,supplierIds:['s1','s2'],permissionMode:'CUSTOM',customPermissions:['view_menu_recipes','edit_menu_recipes','manage_product_specs']},
    'users/viewer':{role:'STAFF',active:true,allBranches:true,permissionMode:'CUSTOM',customPermissions:['view_menu_recipes']},
    'users/operations':{role:'STAFF',active:true,allBranches:true},
    'settings/role_permissions':{map:{}},
    'suppliers/s1':{name:'Synthetic Supplier A',active:true},'suppliers/s2':{name:'Synthetic Supplier B',active:true},
    'products/p1':{name:'Synthetic product',itemCode:'A001',supplierId:'s1',active:true,packSize:'1 kg',casePrice:19,packPrice:8,allowedBranchIds:[]},
    'products/p2':{name:'Synthetic alternative',itemCode:'B002',supplierId:'s2',active:true,packSize:'500 g',casePrice:26,allowedBranchIds:[]}
  }));
  const reads:string[]=[];let failNext=false;
  const snapshot=(path:string,fields?:string[])=>({id:path.split('/').at(-1),exists:data.has(path),data:()=>{
    const value=structuredClone(data.get(path));return value&&fields?Object.fromEntries(fields.filter(k=>k in value).map(k=>[k,value[k]])):value;
  }});
  class Query {
    filters:Array<[string,unknown]>=[];sort='__name__';direction='asc';count=1000;cursor:any;fields?:string[];
    constructor(public path:string){}
    copy(){return Object.assign(new Query(this.path),this);}
    doc(id:string){return doc(`${this.path}/${id}`);}
    where(key:string,_op:string,value:unknown){const q=this.copy();q.filters=[...this.filters,[key,value]];return q;}
    orderBy(key:string,dir='asc'){const q=this.copy();q.sort=key;q.direction=dir;return q;}
    limit(count:number){const q=this.copy();q.count=count;return q;}
    startAfter(cursor:any){const q=this.copy();q.cursor=cursor;return q;}
    select(...fields:string[]){const q=this.copy();q.fields=fields;return q;}
  }
  const doc=(path:string):any=>({path,collection:(name:string)=>new Query(`${path}/${name}`)});
  const db:any={doc,collection:(path:string)=>new Query(path),runTransaction:async(fn:any)=>{
    const writes:Array<{path:string;value:any;create:boolean}>=[];
    const result=await fn({get:async(ref:any)=>{
      assert.equal(writes.length,0,'Transactions must finish all reads before writes.');reads.push(ref.path);
      if(!(ref instanceof Query))return snapshot(ref.path);
      let paths=[...data.keys()].filter(p=>p.startsWith(ref.path+'/')&&p.split('/').length===ref.path.split('/').length+1&&ref.filters.every(([key,value])=>data.get(p)[key]===value));
      const key=(p:string)=>ref.sort==='__name__'?p.split('/').at(-1)!:data.get(p)[ref.sort];
      paths.sort((a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:0)*(ref.direction==='desc'?-1:1));
      if(ref.cursor)paths=paths.filter(p=>ref.direction==='desc'?key(p)<ref.cursor:key(p)>ref.cursor);
      paths=paths.slice(0,ref.count);return {docs:paths.map(p=>snapshot(p,ref.fields)),size:paths.length};
    },create:(ref:any,value:any)=>writes.push({path:ref.path,value,create:true}),set:(ref:any,value:any)=>writes.push({path:ref.path,value,create:false})});
    if(failNext){failNext=false;throw new Error('Synthetic connection failure');}
    for(const w of writes)if(w.create&&data.has(w.path))throw new Error('Duplicate document');
    for(const w of writes)data.set(w.path,structuredClone(w.value));return result;
  }};
  const choice=(productId='p1',supplierId='s1')=>({productId,supplierId,productName:'FORGED',supplierName:'FORGED',itemCode:'FORGED',packSize:'FORGED',note:''});
  const recipe=(id='recipe1',kind='dish'):any=>({id,code:id.toUpperCase(),name:'Synthetic recipe',category:'Synthetic category',kind,photo:'',yieldQuantity:200,yieldUnit:'g',portions:2,
    ingredients:[{id:'row1',name:'Test ingredient',quantity:100,unit:'g',source:'product',preferred:choice(),alternatives:[choice('p2','s2')],preparationId:'',preparationName:'',note:''}],
    method:'Synthetic method for software testing only.',plating:'Synthetic plating.',notes:'Test data only.',sourceReference:'Synthetic fixture'});
  let number=0;
  const save=(r=recipe(),version=0,uid='owner',requestId=`save${++number}`)=>menuAction(db,uid,{action:'menu-save',recipe:r,expectedVersion:version,requestId});
  const get=(id='recipe1',uid='owner')=>menuAction(db,uid,{action:'menu-get',id}) as Promise<any>;
  const approve=async(id='recipe1',uid='owner')=>{const {recipe:r}=await get(id,uid);return menuAction(db,uid,{action:'menu-approve',id,expectedVersion:r.version,expectedDependencyHash:r.dependencyHash,requestId:`approve${++number}`});};
  return {data,reads,db,recipe,choice,save,get,approve,fail:()=>{failNext=true;}};
}

test('draft saves exact product identities, excludes prices, and ignores forged approval',async()=>{
  const f=fixture();await f.save({...f.recipe(),status:'approved',allergenStatus:'approved',approvedByName:'FORGED'});
  const {recipe}=await f.get();assert.equal(recipe.status,'draft');assert.equal(recipe.allergenStatus,'not_reviewed');
  assert.equal(recipe.ingredients[0].preferred.productName,'Synthetic product');assert.equal(recipe.ingredients[0].preferred.supplierName,'Synthetic Supplier A');
  assert.equal(recipe.ingredients[0].alternatives[0].supplierId,'s2');assert.equal(JSON.stringify(recipe).includes('casePrice'),false);
  assert.equal(f.data.get('products/p1').casePrice,19);
});
test('recipe approval is separate from allergen review; any edit returns to draft',async()=>{
  const f=fixture();await f.save();await f.approve();let {recipe}=await f.get();assert.equal(recipe.status,'approved');assert.equal(recipe.version,2);assert.equal(recipe.allergenStatus,'not_reviewed');
  await f.save({...recipe,method:'Updated synthetic method'},2);({recipe}=await f.get());assert.equal(recipe.status,'draft');assert.equal(recipe.approvedAt,'');assert.equal(recipe.version,3);
  assert.equal(f.data.get('menu_recipes/recipe1/versions/00000002').status,'approved');
});
test('unknown quantities stay null and incomplete recipes cannot be approved',async()=>{
  const f=fixture();const r=f.recipe();r.ingredients[0].quantity=null;r.yieldQuantity=null;await f.save(r);const {recipe}=await f.get();assert.equal(recipe.ingredients[0].quantity,null);assert.equal(recipeGaps(recipe).length,2);await assert.rejects(f.approve(),/Complete the recipe/);
  assert.throws(()=>validateRecipe({...r,portions:-1}),/Quantities/);
});
test('concurrent save conflicts, duplicate codes and changed retry payloads are rejected',async()=>{
  const f=fixture(),r=f.recipe();const body={action:'menu-save',recipe:r,expectedVersion:0,requestId:'stable'};
  const first=await menuAction(f.db,'owner',body);const snapshot=structuredClone(f.data);
  assert.deepEqual(await menuAction(f.db,'owner',body),first);assert.deepEqual(f.data,snapshot);
  await assert.rejects(menuAction(f.db,'owner',{...body,recipe:{...r,name:'Other'}}),/already used/);
  await assert.rejects(f.save({...r,name:'Concurrent'},0),/changed elsewhere/);
  await assert.rejects(f.save({...r,id:'recipe2'}),/code is already used/);
  await assert.rejects(f.save({...r,code:'CHANGED'},1),/code and type cannot change/);
});
test('failed writes commit neither recipe, version, code nor duplicate registry',async()=>{
  const f=fixture(),before=structuredClone(f.data);f.fail();await assert.rejects(f.save(),/Synthetic connection failure/);assert.deepEqual(f.data,before);await f.save();assert.equal((await f.get()).recipe.version,1);
});
test('separate workspace permissions cover view, save, approval and uploads',async()=>{
  const f=fixture();await f.save();await assert.rejects(f.get('recipe1','operations'),/does not have access/);
  await f.get('recipe1','viewer');await assert.rejects(f.save(f.recipe(),1,'viewer'),/does not have access/);
  await f.save(f.recipe(),1,'editor');await assert.rejects(f.approve('recipe1','editor'),/does not have access/);
  f.data.get('users/owner').active=false;await assert.rejects(f.get(),/does not have access/);
});
test('supplier scope, product pairing and branch restrictions cannot be bypassed',async()=>{
  const f=fixture();const r=f.recipe();r.ingredients[0].preferred.supplierId='s2';await assert.rejects(f.save(r),/changed supplier/);
  f.data.get('users/editor').supplierIds=['s1'];await assert.rejects(f.save(f.recipe(),0,'editor'),/outside your account/);
  f.data.get('products/p1').allowedBranchIds=['b2'];f.data.set('users/editor',{...f.data.get('users/editor'),supplierIds:['s1','s2'],allBranches:false,branchIds:['b1']});
  await assert.rejects(f.save(f.recipe(),0,'editor'),/branch access/);
  f.data.get('products/p1').allowedBranchIds=[];await f.save();f.data.get('users/editor').supplierIds=['s1'];
  await assert.rejects(f.save({...f.recipe(),ingredients:[]},1,'editor'),/outside your account/);
});
test('catalogue is paginated by one supplier and strips prices on the server',async()=>{
  const f=fixture();for(let i=0;i<65;i++)f.data.set(`products/test${String(i).padStart(3,'0')}`,{...f.data.get('products/p1'),name:`Synthetic ${i}`});
  const first:any=await menuAction(f.db,'viewer',{action:'menu-products',supplierId:'s1'});assert.equal(first.products.length,60);assert.ok(first.cursor);assert.equal(JSON.stringify(first).includes('casePrice'),false);assert.ok(first.products.every((p:any)=>p.supplierId==='s1'));
  const next:any=await menuAction(f.db,'viewer',{action:'menu-products',supplierId:'s1',cursor:first.cursor});assert.equal(next.products.length,6);assert.equal(next.cursor,null);
});
test('product identity and specification changes invalidate saved approval on opening',async()=>{
  const f=fixture();await f.save();await f.approve();assert.equal((await f.get()).sourceChanged,false);
  f.data.get('products/p1').name='Changed synthetic identity';assert.equal((await f.get()).sourceChanged,true);await assert.rejects(f.approve(),/changed/);
  const current=(await f.get()).recipe;await f.save(current,current.version);await f.approve();f.data.set('menu_product_evidence/p2',{revision:1});assert.equal((await f.get()).sourceChanged,true);
});
test('linked preparations are reusable, must be approved and cannot form cycles',async()=>{
  const f=fixture();const preparation=f.recipe('prep1','preparation');await f.save(preparation);
  const dish=f.recipe();dish.ingredients[0]={...dish.ingredients[0],source:'preparation',preferred:null,alternatives:[],preparationId:'prep1'};await f.save(dish);await assert.rejects(f.approve(),/linked preparation/);
  await f.approve('prep1');let d=(await f.get()).recipe;await f.save(d,d.version);await f.approve();
  const self={...preparation,ingredients:[{...dish.ingredients[0],preparationId:'prep1'}]};await assert.rejects(f.save(self,2),/circle/);
  const second={...f.recipe('prep2','preparation'),ingredients:[{...dish.ingredients[0],preparationId:'prep1'}]};await f.save(second);
  await assert.rejects(f.save({...preparation,ingredients:[{...dish.ingredients[0],preparationId:'prep2'}]},2),/circle/);
  const before=(await f.get()).sourceChanged;assert.equal(before,false);await f.save({...preparation,method:'Changed preparation'},2);assert.equal((await f.get()).sourceChanged,true);
});
test('specifications retain exact original bytes and identity with idempotent uploads',async()=>{
  const f=fixture(),base64=Buffer.from('%PDF-1.4\nSynthetic test file only.\n%%EOF').toString('base64');
  const body={action:'menu-spec-upload',requestId:'file1',productId:'p1',fileName:'synthetic-spec.pdf',base64,specificationDate:'2026-10-01',note:'Synthetic source'};
  await assert.rejects(menuAction(f.db,'viewer',body),/does not have access/);
  await menuAction(f.db,'editor',body);const snapshot=structuredClone(f.data);await menuAction(f.db,'editor',body);assert.deepEqual(f.data,snapshot);
  const download:any=await menuAction(f.db,'viewer',{action:'menu-spec-download',id:'file1',productId:'p1'});assert.equal(download.base64,base64);
  await assert.rejects(menuAction(f.db,'owner',{action:'menu-spec-download',id:'file1',productId:'p2'}),/not attached/);
  await assert.rejects(menuAction(f.db,'editor',{...body,note:'different'}),/already used/);
  assert.equal(f.data.get('menu_product_specs/file1').status,'unreviewed');assert.equal(f.data.get('menu_product_evidence/p1').revision,1);
});
test('file validation rejects renamed executables, oversized files, paths and invalid dates',()=>{
  const base={fileName:'test.pdf',base64:Buffer.from('%PDF-1.4\nSynthetic').toString('base64'),specificationDate:'',note:''};
  assert.throws(()=>validateSpecification({...base,fileName:'../test.pdf'}),/simple file name/);
  assert.throws(()=>validateSpecification({...base,base64:Buffer.from('MZbad').toString('base64')}),/contents do not match/);
  assert.throws(()=>validateSpecification({...base,fileName:'test.exe'}),/Use PDF/);
  assert.throws(()=>validateSpecification({...base,base64:Buffer.alloc(2*1024*1024+1).toString('base64')}),/2 MB|larger/);
  assert.throws(()=>validateSpecification({...base,specificationDate:'2026-02-30'}),/valid specification date/);
});
test('dish codes remain stable and a product cannot be its own alternative',()=>{
  const f=fixture(),r=f.recipe();r.ingredients[0].alternatives=[f.choice()];assert.throws(()=>validateRecipe(r),/only once/);assert.throws(()=>validateRecipe({...r,code:'../bad'}),/letters, numbers/);
});


test('separate app bootstrap exposes only authorised suppliers and menu permissions',async()=>{
  const f=fixture();f.data.get('users/editor').supplierIds=['s1'];f.data.get('users/editor').password='PRIVATE TEST VALUE';f.data.get('suppliers/s1').email='private@example.invalid';
  const result:any=await menuAction(f.db,'editor',{action:'menu-bootstrap'});
  assert.deepEqual(result.suppliers,[{id:'s1',name:'Synthetic Supplier A'}]);assert.deepEqual(result.account.permissions,['view_menu_recipes','edit_menu_recipes','manage_product_specs']);
  assert.equal(JSON.stringify(result).includes('PRIVATE TEST VALUE'),false);assert.equal(JSON.stringify(result).includes('private@example.invalid'),false);
  await assert.rejects(menuAction(f.db,'operations',{action:'menu-bootstrap'}),/does not have access/);
});

test('corrupt specification chunks are rejected on download',async()=>{
  const f=fixture();await menuAction(f.db,'owner',{action:'menu-spec-upload',requestId:'corrupt',productId:'p1',fileName:'synthetic.pdf',base64:Buffer.from('%PDF-1.4 original').toString('base64')});
  f.data.set('menu_product_specs/corrupt/chunks/0',{base64:Buffer.from('%PDF-1.4 changed').toString('base64')});
  await assert.rejects(menuAction(f.db,'owner',{action:'menu-spec-download',id:'corrupt',productId:'p1'}),/integrity check/);
});
