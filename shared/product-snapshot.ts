// A scoped read must not replace records belonging to suppliers it did not query.
export function mergeProductSnapshot<T extends {id:string;supplierId:string}>(current:T[],received:T[],supplierId?:string):T[]{
 const retained=supplierId===undefined?current:current.filter(product=>product.supplierId!==supplierId);
 const merged=new Map(retained.map(product=>[product.id,product]));
 for(const product of received)merged.set(product.id,product);
 return [...merged.values()];
}
