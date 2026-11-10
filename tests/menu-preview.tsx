import React from 'react';
import {createRoot} from 'react-dom/client';
import {MenuShell} from '../apps/standard-menu/App';
import '../app/htos/htos.css';
import '../app/htos/brand.css';
import {MenuApiProvider} from '../apps/standard-menu/menuApi';
import {newRecipe,newIngredient,recipeGaps,tofuVegetableRamenExample} from '../shared/menu-recipes';
import type {Recipe,Specification} from '../shared/menu-recipes';

const products=[{id:'demo-product-a',supplierId:'demo-supplier-a',name:'Demonstration rice',itemCode:'DEMO-A001',packSize:'1 kg'},
  {id:'demo-product-b',supplierId:'demo-supplier-b',name:'Alternative demonstration rice',itemCode:'DEMO-B001',packSize:'500 g'}];
const base=newRecipe();
const example:Recipe={...base,id:'demo-recipe',code:'DEMO1',name:'Demonstration rice bowl',category:'Preview dishes',
  ingredients:[{...newIngredient(),id:'demo-row',name:'Demonstration rice',quantity:100,unit:'g',preferred:{productId:products[0].id,supplierId:products[0].supplierId,productName:products[0].name,supplierName:'Demo Supplier A',itemCode:products[0].itemCode,packSize:products[0].packSize,note:''}}],
  yieldQuantity:200,yieldUnit:'g',portions:2,method:'Synthetic method for interface testing. Not a kitchen instruction.',plating:'Synthetic presentation for interface testing.',
  notes:'This preview uses synthetic records and does not connect to production.',version:1,status:'draft',allergenStatus:'not_reviewed',updatedAt:'2026-10-17T10:00:00Z',updatedBy:'demo-user',updatedByName:'Demo user',approvedAt:'',approvedByName:'',dependencyHash:'demo'};
const records=new Map([[example.id,example]]),specs=new Map<string,Specification&{base64:string}>();
const viewOnly=new URLSearchParams(location.search).has('readonly');
const session={account:{id:'demo-user',displayName:'Demo user',permissions:viewOnly?['view_menu_recipes']:['view_menu_recipes','edit_menu_recipes','approve_menu_recipes','manage_product_specs']},suppliers:[{id:'demo-supplier-a',name:'Demo Supplier A'},{id:'demo-supplier-b',name:'Demo Supplier B'}],supplierCursor:null,loadMoreSuppliers:async()=>{}};

async function previewApi(body:any) {
  if(body.action==='menu-list')return {recipes:[...records.values()],cursor:null};
  if(body.action==='menu-products')return {products:products.filter(p=>p.supplierId===body.supplierId),cursor:null};
  if(body.action==='menu-get')return {recipe:structuredClone(records.get(body.id)),sourceChanged:false,issues:[]};
  if(body.action==='menu-save'){
    if(!body.recipe.code||!body.recipe.name)throw new Error('Enter a recipe code and name.');
    const prior=records.get(body.recipe.id);if((prior?.version||0)!==body.expectedVersion)throw new Error('The recipe changed elsewhere.');
    const r={...body.recipe,version:(prior?.version||0)+1,status:'draft',allergenStatus:'not_reviewed',updatedAt:new Date().toISOString(),updatedBy:'demo-user',updatedByName:'Demo user',approvedAt:'',approvedByName:'',dependencyHash:'demo'};
    records.set(r.id,r);return {id:r.id,version:r.version};
  }
  if(body.action==='menu-approve'){const r=records.get(body.id)!;if(recipeGaps(r).length)throw new Error('Complete the recipe.');records.set(r.id,{...r,version:r.version+1,status:'approved',approvedAt:new Date().toISOString(),approvedByName:'Demo user'});return {id:r.id};}
  if(body.action==='menu-spec-list')return {specifications:[...specs.values()].filter(s=>s.productId===body.productId),cursor:null};
  if(body.action==='menu-spec-upload'){const p=products.find(p=>p.id===body.productId)!;specs.set(body.requestId,{...body,id:body.requestId,supplierId:p.supplierId,mime:'application/pdf',bytes:atob(body.base64).length,uploadedAt:new Date().toISOString(),uploadedByName:'Demo user',status:'unreviewed',checksum:'preview'});return {id:body.requestId};}
  if(body.action==='menu-spec-download')return specs.get(body.id);
  if(body.action==='menu-history'){const r=records.get(body.id)!;return {versions:[r]};}
  throw new Error('Unknown preview action.');
}
createRoot(document.getElementById('root')!).render(<MenuApiProvider value={previewApi}><MenuShell session={session} preview initialRecipe={tofuVegetableRamenExample()} onSignOut={()=>location.reload()}/></MenuApiProvider>);
