export interface InvoiceFilters {branchId:string;supplierId:string;status:string;search:string}
export const emptyInvoiceFilters:InvoiceFilters={branchId:'',supplierId:'',status:'',search:''};
export function parseInvoiceFilters(value:string|null):InvoiceFilters{
 try{const v=JSON.parse(value||'null');return Object.fromEntries(Object.keys(emptyInvoiceFilters).map(k=>[k,typeof v?.[k]==='string'&&v[k].length<=200?v[k]:''])) as unknown as InvoiceFilters;}catch{return {...emptyInvoiceFilters};}
}
export function loadInvoiceFilters(scope?:string):InvoiceFilters{
 try{return scope?parseInvoiceFilters(sessionStorage.getItem('htos:invoice-filters:'+scope)):{...emptyInvoiceFilters};}catch{return {...emptyInvoiceFilters};}
}
export function saveInvoiceFilters(scope:string|undefined,value:InvoiceFilters){
 try{if(scope)sessionStorage.setItem('htos:invoice-filters:'+scope,JSON.stringify(value));}catch{/* Storage is optional; filtering still works. */}
}
