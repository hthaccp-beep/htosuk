export type OrderedRecord = {id:string;displayOrder?:number};
const rank=(item:OrderedRecord)=>Number.isFinite(item.displayOrder)?item.displayOrder!:0;

/** Stable for older unranked records; never mutate the store's input array. */
export function savedListOrder<T extends OrderedRecord>(items:readonly T[]):T[]{
 return [...items].sort((a,b)=>rank(a)-rank(b));
}

/** Persist only positions. Legacy equal ranks are repaired in a single atomic batch. */
export function planListMove<T extends OrderedRecord>(items:readonly T[],source:number,destination:number){
 if(!Number.isInteger(source)||!Number.isInteger(destination)||!items[source]||!items[destination])throw new Error('This list changed. Try rearranging it again.');
 if(source===destination)return [];
 const ordered=[...items], [moved]=ordered.splice(source,1);ordered.splice(destination,0,moved);
 const before=destination>0?rank(ordered[destination-1]):undefined;
 const after=destination<ordered.length-1?rank(ordered[destination+1]):undefined;
 const position=before===undefined?after!-1000:after===undefined?before+1000:before+(after-before)/2;
 if(Number.isFinite(position)&&(before===undefined||position>before)&&(after===undefined||position<after))return [{id:moved.id,displayOrder:position}];
 return ordered.map((item,index)=>({id:item.id,displayOrder:(index+1)*1000})).filter(item=>items.find(old=>old.id===item.id)?.displayOrder!==item.displayOrder);
}

export function nextListPosition(items:readonly OrderedRecord[]){
 return Math.max(0,...items.map(rank))+1000;
}

// Matches the existing Firestore supplier-write rule; no new access is granted.
export function canArrangeSuppliers(user:{active?:boolean;role?:string}|null|undefined){
 return user?.active===true&&['CREATOR','GM'].includes(user.role||'');
}
