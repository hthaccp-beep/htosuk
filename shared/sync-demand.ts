export function syncDemand(location:string){
 const [path,search='']=location.split('?'),tab=new URLSearchParams(search).get('tab')||'users';
 const all=path==='*',settings=path==='/settings',approvals=path==='/catalogue-prices'||settings&&tab==='approvals';
 const catalogue=settings&&['products','categories','suppliers','approvals','system','import'].includes(tab);
 return {
  users:all||settings&&['users','system','import'].includes(tab),
  roles:all||settings&&['users','roles','system','import'].includes(tab),
  departments:all||settings&&['users','suppliers','system','import'].includes(tab),
  // Product editing subscribes to the explicitly selected supplier only.
  // Category integrity/reassignment still needs its complete reference set.
  // Supplier deletion requests its complete integrity check on demand.
  products:all||settings&&tab==='categories'||approvals||['/orders','/deliveries','/checks'].includes(path),
  productExists:path==='/',
  categories:all||catalogue||approvals||['/new-order','/checklists'].includes(path),
  email:all||settings&&['email','services'].includes(tab),
  priceSettings:all||approvals||settings&&tab==='prices'||path==='/checks'||path==='/orders',
  priceNotices:all||approvals||path==='/',
  priceHistory:all||approvals,
  newItems:all||approvals,
  orders:all||['/','/orders','/deliveries','/checks','/reports'].includes(path),
 };
}
