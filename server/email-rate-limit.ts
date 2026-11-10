/** Shared SMTP limit, independent of transport; documents are server-only. */
export async function reserveEmailSend(db:any,uid:string):Promise<boolean>{
 const refs=[{ref:db.collection('_email_send_limits').doc(`user_${uid}`),limit:20},{ref:db.collection('_email_send_limits').doc('global'),limit:100}];
 return db.runTransaction(async(tx:any)=>{const windowStart=Math.floor(Date.now()/60000)*60000;const snaps=await Promise.all(refs.map(r=>tx.get(r.ref)));const counts=snaps.map(s=>{const d=s.data();return d?.windowStart===windowStart&&Number.isInteger(d.count)?Math.max(0,d.count):0;});if(counts.some((c,i)=>c>=refs[i].limit))return false;refs.forEach((r,i)=>tx.set(r.ref,{windowStart,count:counts[i]+1}));return true;});
}
