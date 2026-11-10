import React,{useState} from 'react';
import {ProductTransfer} from '../app/htos/ProductTransfer';
import {SupplierFileReview} from '../app/htos/SupplierFileReview';

// Synthetic component check. No API calls, saves or file picker required.
export function SupplierReviewPreview(){
 const [result,setResult]=useState('');
 if(new URLSearchParams(location.search).get('supplierReview')==='flow')return <><p>Offline supplier import</p><ProductTransfer supplierId="qa-s" onSaved={()=>setResult('Synthetic updates confirmed. No network requests.')} />{result&&<p role="status">{result}</p>}</>;
 const empty=new URLSearchParams(location.search).get('supplierReview')==='empty';
 const rows=Array.from({length:24},(_,i)=>({'ITEMNO':`QA${String(i+1).padStart(3,'0')}`,'ITEM DESCRIPTION':['Sample rice','Fresh Shanghai noodles – family pack','Soy sauce'][i%3],'CASE PRICE':i===1?'36':'19','ORDER BY CASE':'','ORDER BY PIECE':''}));
 return <><p>Offline matching check</p>{result?<p role="status">{result}</p>:<SupplierFileReview document={{rows,scanned:false}} file={new File(['synthetic'],'Sample supplier.xlsx')} supplierId={empty?'qa-empty':'qa-s'} busy={false} error={null} onClose={()=>setResult('Closed without saving')} onReview={csv=>setResult(`Review reached. ${csv.split('\n').length-1} price rows prepared. Nothing saved.`)}/>}</>;
}
