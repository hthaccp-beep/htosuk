import {api} from './ui';
import {readSupplierFileData} from '../../shared/supplier-file-reader';
export const readSupplierFile=(file:File)=>readSupplierFileData(file,async(file,mime)=>{
 const base64str=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('Could not read this file.'));r.readAsDataURL(file);});
 return api('/api/scan-invoice',{base64str,mimeType:mime,fileName:file.name});
});
