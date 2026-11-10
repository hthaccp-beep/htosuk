import type {Product,Category,Supplier} from '../types.ts';
export type CatalogueChange={collection:'products'|'categories'|'suppliers';id:string;patch?:Record<string,unknown>};
export function supplierRemoval(id:string,target:string|undefined,products:Product[],categories:Category[],suppliers:Supplier[]):CatalogueChange[]{
 const linked=products.filter(p=>p.supplierId===id),cats=categories.filter(c=>c.supplierId===id);
 if(!target&&(linked.length||cats.length))throw new Error('Reassign the catalogue first, or deactivate this supplier.');
 if(target&&(target===id||!suppliers.some(s=>s.id===target&&s.active)))throw new Error('Choose an active replacement supplier.');
 if(cats.some(c=>products.some(p=>p.categoryId===c.id&&p.supplierId!==id)))throw new Error('A category is shared with another supplier. Correct those links before deleting.');
 const changes:CatalogueChange[]=[...linked.map(p=>({collection:'products' as const,id:p.id,patch:{supplierId:target}})),...cats.map(c=>({collection:'categories' as const,id:c.id,patch:{supplierId:target}})),{collection:'suppliers',id}];
 if(changes.length>450)throw new Error('This catalogue is too large for a single safe removal. Deactivate the supplier instead.');
 return changes;
}
export function categoryRemoval(id:string,target:string|undefined,products:Product[],categories:Category[]):CatalogueChange[]{
 const linked=products.filter(p=>p.categoryId===id),replacement=categories.find(c=>c.id===target);
 if(linked.length&&!target)throw new Error('Reassign the products before deleting this category.');
 if(target&&(target===id||!replacement?.active||linked.some(p=>replacement.supplierId&&replacement.supplierId!==p.supplierId)))throw new Error('Choose an active category for the same supplier.');
 const changes:CatalogueChange[]=[...linked.map(p=>({collection:'products' as const,id:p.id,patch:{categoryId:target}})),{collection:'categories',id}];
 if(changes.length>450)throw new Error('This category is too large for a single safe removal. Move products in smaller groups first.');
 return changes;
}
