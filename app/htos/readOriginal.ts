import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, collection, query, orderBy, documentId, limit, startAfter, getDocsFromServer, type QueryDocumentSnapshot } from 'firebase/firestore';
import { IMPORT_COLLECTIONS, parseBusinessExport, type BusinessExport } from '../../shared/business-import';

// Explicit, temporary read-only migration connection. Never used by HTOS's operational store.
// These are public web-app identifiers from Allan's original export, not server credentials.
const originalWebConfig={apiKey:'AIzaSyAdvnUYSXmKBYf5OXuoTW0dZJr89MaUIfQ',authDomain:'ordersystemv3.firebaseapp.com',projectId:'ordersystemv3',appId:'1:601421430072:web:1d3cc20d8b218c8e7cd5cd'};
export async function readOriginal(email:string,password:string,onProgress:(text:string)=>void):Promise<BusinessExport> {
  const app=initializeApp(originalWebConfig,'htos-readonly-import-'+crypto.randomUUID());
  const sourceAuth=getAuth(app);
  try {
    await setPersistence(sourceAuth,inMemoryPersistence);
    const signed=await signInWithEmailAndPassword(sourceAuth,email.trim(),password);
    const sourceDb=getFirestore(app);
    const profile=(await getDocFromServer(doc(sourceDb,'users',signed.user.uid))).data();
    if(profile?.active!==true||!['CREATOR','GM'].includes(profile.role))throw new Error('Use an active owner or general-manager account from OrderSystem2027 to read its complete history.');
    const data:BusinessExport={};
    for(const name of IMPORT_COLLECTIONS) {
      data[name]=[];let cursor:QueryDocumentSnapshot|undefined;
      while(true) {
        const page=await getDocsFromServer(query(collection(sourceDb,name),orderBy(documentId()),...(cursor?[startAfter(cursor)]:[]),limit(200)));
        data[name]!.push(...page.docs.map(snapshot=>({...snapshot.data(),id:snapshot.id})));
        onProgress(`Reading ${name}: ${data[name]!.length} records`);
        if(page.size<200)break;
        cursor=page.docs[page.docs.length-1];
      }
    }
    return parseBusinessExport({data});
  } finally {
    await signOut(sourceAuth).catch(()=>{});
    await deleteApp(app).catch(()=>{});
  }
}
