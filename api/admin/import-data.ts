import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdmin } from '../firebase-admin.ts';
import { runBusinessImport, ImportError } from '../../server/business-import-service.ts';

export default async function handler(req:VercelRequest,res:VercelResponse) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if(!token)return res.status(401).json({error:'Please sign in to HTOS.'});
  try {
    const {auth,db}=getAdmin();let uid:string;
    try{uid=(await auth.verifyIdToken(token,true)).uid;}catch{return res.status(401).json({error:'Please sign in to HTOS again.'});}
    const result=await runBusinessImport(req.body,uid,{transaction:work=>db.runTransaction(async transaction=>work({
      profile:async()=> (await transaction.get(db.collection('users').doc(uid))).data(),
      get:async(collection,id)=>{const snapshot=await transaction.get(db.collection(collection).doc(id));return snapshot.exists?{...snapshot.data(),id:snapshot.id} as any:undefined;},
      create:(collection,record)=>{transaction.create(db.collection(collection).doc(record.id),record);},
    }))});
    return res.status(200).json(result);
  } catch(error) {
    if(error instanceof ImportError)return res.status(error.status).json({error:error.message});
    return res.status(500).json({error:'The import could not finish. Previously completed batches are safe; preview and retry to resume.'});
  }
}
