// Local emulator only. No Firebase configuration, credentials or production data.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8085')throw new Error('Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 to run this isolated check.');
const base='http://127.0.0.1:8085/v1/projects/demo-htos/databases/(default)/documents';
const prefix='incoming-qa-'+randomUUID();
const id=name=>prefix+'-'+name;
const encode=value=>typeof value==='boolean'?{booleanValue:value}:typeof value==='number'?{integerValue:String(value)}:Array.isArray(value)?{arrayValue:{values:value.map(encode)}}:typeof value==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))}}:{stringValue:value};
const token=uid=>[Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({iss:'https://securetoken.google.com/demo-htos',aud:'demo-htos',sub:uid,user_id:uid,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}})).toString('base64url'),''].join('.');
const seeded=[];const checks=[];
async function request(path,uid,method='GET',body){
 return fetch(base+path,{method,headers:{authorization:'Bearer '+(uid==='owner'?'owner':token(id(uid))),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}
async function seed(collection,name,value){const path='/'+collection+'/'+id(name);const response=await request(path,'owner','PATCH',encode(value).mapValue);assert.equal(response.status,200,await response.text());if(!seeded.includes(path))seeded.push(path);}
async function checkRead(name,uid,order,allowed){const response=await request('/orders/'+id(order),uid);assert.equal(response.status,allowed?200:403,name+': '+await response.text());checks.push(name);}
async function checkQuery(name,uid,supplier,allowed){const response=await request(':runQuery',uid,'POST',{structuredQuery:{from:[{collectionId:'orders'}],where:{fieldFilter:{field:{fieldPath:'supplierId'},op:'EQUAL',value:{stringValue:id(supplier)}}}}});assert.equal(response.status,allowed?200:403,name+': '+await response.text());checks.push(name);}
const manager={id:id('manager'),role:'MANAGER',active:true,branchId:id('ordering'),supplierIds:[id('external')],permissionMode:'CUSTOM',customPermissions:['view_received_orders']};
try{
 for(const [name,active,actsAsSupplier]of[['ordering',true,false],['cpu',true,true],['sushi',true,true],['closed',false,true],['collision',true,true]])await seed('branches',name,{id:id(name),active,actsAsSupplier});
 for(const [name,branch]of[['internal','cpu'],['other','sushi'],['closed-supplier','closed'],['external',''],['collision','']])await seed('suppliers',name,{id:id(name),linkedBranchId:branch?id(branch):''});
 for(const [name,supplier]of[['incoming','internal'],['other-order','other'],['legacy','cpu'],['closed-order','closed-supplier'],['collision-order','collision']])await seed('orders',name,{id:id(name),branchId:id('other-ordering'),supplierId:id(supplier),status:'PLACED',items:[{productName:'Historic sample',unitPrice:12}],createdAt:'2026-10-01T00:00:00Z'});
 await seed('users','manager',manager);
 await checkRead('Unassigned manager denied incoming order','manager','incoming',false);
 await checkQuery('Unassigned manager denied incoming query','manager','internal',false);
 await seed('users','manager',{...manager,allBranches:true});
 await checkRead('All ordering branches does not grant supplying access','manager','incoming',false);
 await seed('users','manager',{...manager,branchIds:[id('cpu')]});
 await checkRead('Additional supplying branch grants incoming read','manager','incoming',true);
 await checkQuery('Assigned supplying branch query succeeds','manager','internal',true);
 await checkRead('Other supplying branch remains denied','manager','other-order',false);
 await checkRead('Legacy branch-ID incoming order remains readable','manager','legacy',true);
 await seed('users','manager',{...manager,branchId:id('cpu')});
 await checkRead('Primary supplying branch grants incoming read','manager','incoming',true);
 await seed('users','manager',{...manager,branchId:id('cpu'),customPermissions:[]});
 await checkRead('Incoming permission revocation takes effect','manager','incoming',false);
 await seed('users','manager',{...manager,branchIds:[id('closed'),id('collision')]});
 await checkRead('Inactive supplying branch is denied','manager','closed-order',false);
 await checkRead('Unrelated supplier matching a branch ID is denied','manager','collision-order',false);
 await seed('users','manager',{...manager,branchIds:[id('cpu')],active:false});
 await checkRead('Inactive account is denied','manager','incoming',false);
 await seed('users','manager',{...manager,role:'CREATOR'});
 await checkRead('Workspace owner keeps oversight','manager','incoming',true);
 await seed('users','manager',{...manager,branchIds:[id('cpu')]});
 await seed('branches','cpu',{id:id('cpu'),active:true,actsAsSupplier:false});
 await checkRead('Removing supplying status revokes incoming access','manager','incoming',false);
 const original=await request('/orders/'+id('incoming'),'owner');
 assert.deepEqual((await original.json()).fields.items.arrayValue.values[0].mapValue.fields,{productName:{stringValue:'Historic sample'},unitPrice:{integerValue:'12'}});checks.push('Original order snapshot remains unchanged');
 console.log(JSON.stringify({passed:true,checks,productionReads:0,productionWrites:0},null,2));
}finally{
 for(const path of seeded)await request(path,'owner','DELETE');
}
